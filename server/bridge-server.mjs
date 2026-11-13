import http from "node:http";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  defaultRuntimeHome,
  getProjectById,
  getProjectsSnapshot,
  registerProject,
  setActiveProjectId,
  reorderProjects,
  unregisterProject,
  reconcileProjects,
} from "./project-registry.mjs";
import { getProjectProfile, listProjectProfiles, saveProjectProfile } from "./project-profiles.mjs";
import {
  createDirectoryNode,
  createDocumentNode,
  deleteDocumentNode,
  duplicateDocumentNode,
  moveDocumentNode,
  renameDocumentNode,
} from "./project-node-operations.mjs";
import { readMarkdownDocument } from "./project-reader.mjs";
import { readProjectAsset } from './project-asset.mjs';
import { buildLinkIndex } from "./link-index.mjs";
import { revealMarkdownDocumentInExplorer } from './document-reveal.mjs';
import { DocumentConflictError, writeMarkdownDocument } from "./project-writer.mjs";
import { createProjectTreeCache } from "./project-tree-cache.mjs";
import { appendServiceLog } from "./service-log.mjs";
import { createWebUiRuntime } from "./web-ui.mjs";
import { requestServiceHost } from "./service-host-protocol.mjs";

const DEFAULT_PORT = 8797;

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  const runtimeHome = options.runtimeHome ?? defaultRuntimeHome();
  try {
    const server = await startBridgeServer(options);
    process.stdout.write(`md-reader bridge is running at http://127.0.0.1:${options.port}/\n`);
    const shutdown = async () => {
      await stopBridgeServer(server, options);
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("uncaughtException", async (error) => {
      await appendServiceLog(runtimeHome, "uncaught_exception", { error: error.stack ?? String(error) });
      process.exit(1);
    });
    process.on("unhandledRejection", async (reason) => {
      await appendServiceLog(runtimeHome, "unhandled_rejection", { error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason) });
      process.exit(1);
    });
  } catch (error) {
    await appendServiceLog(runtimeHome, "startup_failed", { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    process.exitCode = 1;
  }
}

export async function startBridgeServer({
  port = DEFAULT_PORT,
  runtimeHome = defaultRuntimeHome(),
  stateFile,
  webMode = "dev",
  generation = 0,
  nonce = "standalone",
} = {}) {
  await mkdir(runtimeHome, { recursive: true });
  const projectTreeCache = createProjectTreeCache({ runtimeHome });
  const server = http.createServer();
  const webUiRuntime = await createWebUiRuntime({
    mode: webMode,
    projectRoot: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    server,
  });
  server.on("request", async (request, response) => {
    try {
      await handleRequest(request, response, { runtimeHome, port, stateFile, server, webUiRuntime, projectTreeCache });
    } catch (error) {
      await appendServiceLog(runtimeHome, "request_failed", {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      sendJson(response, error.status ?? 500, {
        error: error instanceof Error ? error.message : String(error),
        code: error.code,
        lockCleanupWarning: error.lockCleanupWarning,
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  server.__mdReaderWebUiRuntime = webUiRuntime;
  server.__mdReaderWebMode = webUiRuntime.mode ?? webMode;
  server.__mdReaderGeneration = Number(generation);
  server.__mdReaderNonce = nonce;
  await appendServiceLog(runtimeHome, "started", { pid: process.pid, port, webMode: server.__mdReaderWebMode });
  return server;
}

export async function stopBridgeServer(server, { stateFile, runtimeHome = defaultRuntimeHome() } = {}) {
  await server.__mdReaderWebUiRuntime?.close?.();
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  if (stateFile) {
    try {
      await writeFile(stateFile, "");
    } catch {
      // Standalone/test callers may still provide an explicit legacy state file.
    }
  }
  await appendServiceLog(runtimeHome, "stopped", { pid: process.pid });
}

async function handleRequest(request, response, { runtimeHome, port, stateFile, server, webUiRuntime, projectTreeCache }) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      serviceId: "md-reader-bridge",
      mode: "local-service",
      projectsLoaded: null,
      port,
      generation: server.__mdReaderGeneration,
      nonce: server.__mdReaderNonce,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/internal/shutdown") {
    if (request.headers["x-md-reader-bridge-nonce"] !== server.__mdReaderNonce) {
      sendJson(response, 403, { error: "Bridge identity mismatch." });
      return;
    }
    sendJson(response, 200, { ok: true });
    queueBridgeShutdown({ server, port, runtimeHome, stateFile });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/service/stop") {
    sendJson(response, 202, { ok: true });
    void requestServiceHost(runtimeHome, { command: "stop" }, { timeoutMs: 10000 }).catch((error) =>
      appendServiceLog(runtimeHome, "service_control_failed", { action: "stop", error: error.message ?? String(error) }),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/service/restart") {
    sendJson(response, 202, { ok: true });
    void requestServiceHost(runtimeHome, { command: "restart" }, { timeoutMs: 15000 }).catch((error) =>
      appendServiceLog(runtimeHome, "service_control_failed", { action: "restart", error: error.message ?? String(error) }),
    );
    return;
  }

  const profileProjectsMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/projects$/);
  if (request.method === "GET" && profileProjectsMatch) {
    const profileId = decodeURIComponent(profileProjectsMatch[1]);
    sendJson(response, 200, await getProjectsSnapshot(runtimeHome, profileId));
    return;
  }

  const registerMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/projects\/register$/);
  if (request.method === "POST" && registerMatch) {
    const profileId = decodeURIComponent(registerMatch[1]);
    const body = await readJsonBody(request);
    const payload = await registerProject({
      runtimeHome,
      profileId,
      rootPath: body.rootPath,
      expectedRevision: body.expectedRevision,
    });
    sendJson(response, 200, payload);
    return;
  }

  const activeMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/projects\/active$/);
  if (request.method === "POST" && activeMatch) {
    const profileId = decodeURIComponent(activeMatch[1]);
    const body = await readJsonBody(request);
    const snapshot = await setActiveProjectId(runtimeHome, profileId, body.projectId, body.expectedRevision);
    sendJson(response, 200, snapshot);
    return;
  }

  const registryAction = url.pathname.match(/^\/api\/profiles\/([^/]+)\/projects\/(reorder|unregister|reconcile)$/);
  if (request.method === 'POST' && registryAction) {
    const body = await readJsonBody(request);
    const actions = { reorder: reorderProjects, unregister: unregisterProject, reconcile: reconcileProjects };
    const snapshot = await actions[registryAction[2]]({ ...body, runtimeHome, profileId: decodeURIComponent(registryAction[1]) });
    sendJson(response, 200, snapshot);
    return;
  }

  const treeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/tree$/);
  if (request.method === "GET" && treeMatch) {
    const profileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(treeMatch[1]);
    const project = await getProjectById(runtimeHome, profileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }
    const result = await projectTreeCache.get(project, {
      mode: url.searchParams.get("mode") ?? "prefer-cache",
      refreshId: url.searchParams.get("refreshId") ?? undefined,
    });
    if (result.status === "ready") {
      sendJson(response, 200, { status: "ready", snapshot: result.snapshot, refreshId: result.refreshId });
      return;
    }
    if (result.status === "indexing" || result.status === "refreshing") {
      sendJson(response, 202, result);
      return;
    }
    if (result.status === "failed") {
      await appendServiceLog(runtimeHome, "tree_refresh_failed", {
        projectId,
        profileId,
        refreshId: result.refreshId,
        error: result.error.message,
      });
      sendJson(response, 503, { error: result.error.message, code: "TREE_REFRESH_FAILED", refreshId: result.refreshId });
      return;
    }
    sendJson(response, 404, { error: "Unknown or expired refreshId" });
    return;
  }

  const linkIndexMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/link-index$/);
  if (request.method === "GET" && linkIndexMatch) {
    const profileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(linkIndexMatch[1]);
    const project = await getProjectById(runtimeHome, profileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }
    sendJson(response, 200, await buildLinkIndex(project.rootPath, project.contentRoots));
    return;
  }

  const profilesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/profiles$/);
  if (request.method === "GET" && profilesMatch) {
    const registryProfileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(profilesMatch[1]);
    const project = await getProjectById(runtimeHome, registryProfileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }

    sendJson(response, 200, {
      profileIds: await listProjectProfiles(project.rootPath),
    });
    return;
  }

  const profileMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/profile$/);
  if (request.method === "GET" && profileMatch) {
    const registryProfileId = url.searchParams.get("registryProfileId") ?? "default";
    const targetProfileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(profileMatch[1]);
    const project = await getProjectById(runtimeHome, registryProfileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }

    sendJson(response, 200, {
      profile: await getProjectProfile(project.rootPath, targetProfileId),
    });
    return;
  }

  if (request.method === "POST" && profileMatch) {
    const registryProfileId = url.searchParams.get("registryProfileId") ?? "default";
    const projectId = decodeURIComponent(profileMatch[1]);
    const project = await getProjectById(runtimeHome, registryProfileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }

    const body = await readJsonBody(request);
    sendJson(response, 200, {
      profile: await saveProjectProfile(project.rootPath, body.profile ?? body),
    });
    return;
  }

  const assetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/asset$/);
  if ((request.method === 'GET' || request.method === 'HEAD') && assetMatch) {
    const projectId = decodeURIComponent(assetMatch[1]);
    const project = await getProjectById(runtimeHome, url.searchParams.get('profileId') ?? 'default', projectId);
    if (!project) { sendJson(response, 404, { error: `Unknown project: ${projectId}` }); return; }
    const asset = await readProjectAsset(project.rootPath, project.contentRoots, url.searchParams.get('path'), { head: request.method === 'HEAD' });
    response.writeHead(200, asset.headers);
    response.end(asset.body);
    return;
  }

  const documentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/document$/);
  const documentRevealMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/document\/reveal$/);
  if (request.method === 'POST' && documentRevealMatch) {
    const profileId = url.searchParams.get('profileId') ?? 'default';
    const projectId = decodeURIComponent(documentRevealMatch[1]);
    const project = await getProjectById(runtimeHome, profileId, projectId);
    if (!project) { sendJson(response, 404, { error: `Unknown project: ${projectId}` }); return; }
    try {
      sendJson(response, 200, await revealMarkdownDocumentInExplorer(project.rootPath, project.contentRoots, (await readJsonBody(request)).path ?? ''));
    } catch (error) {
      const code = error?.code ?? 'DOCUMENT_REVEAL_FAILED';
      sendJson(response, code === 'DOCUMENT_REVEAL_UNSUPPORTED' ? 501 : code === 'DOCUMENT_REVEAL_NOT_FOUND' ? 404 : 400, { error: error instanceof Error ? error.message : String(error), code });
    }
    return;
  }
  if (request.method === "GET" && documentMatch) {
    const profileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(documentMatch[1]);
    const documentPath = url.searchParams.get("path") ?? "";
    const project = await getProjectById(runtimeHome, profileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }

    const document = await readMarkdownDocument(project.rootPath, project.contentRoots, documentPath);
    sendJson(response, 200, document);
    return;
  }

  if (request.method === "POST" && documentMatch) {
    const profileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(documentMatch[1]);
    const project = await getProjectById(runtimeHome, profileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }

    const body = await readJsonBody(request);

    try {
      const document = await writeMarkdownDocument(
        project.rootPath,
        project.contentRoots,
        body.path ?? "",
        body.content ?? "",
        body.expectedMtimeMs,
        body.expectedContentHash ?? null,
      );
      try {
        await projectTreeCache.markMutation(project);
      } catch (error) {
        sendJson(response, 503, {
          error: error instanceof Error ? error.message : String(error),
          code: "DOCUMENT_SAVED_CACHE_INVALIDATION_FAILED",
          document,
          treeEntry: document.treeEntry,
        });
        return;
      }
      sendJson(response, 200, { ...document, treeEntry: document.treeEntry, treeStatus: "dirty" });
    } catch (error) {
      if (error instanceof DocumentConflictError) {
        sendJson(response, 409, {
          error: error.message,
          code: "DOCUMENT_CONFLICT",
          conflictKind: error.kind,
          path: error.path,
          currentMtimeMs: error.currentMtimeMs,
          currentContentHash: error.currentContentHash,
        });
        return;
      }

      throw error;
    }
    return;
  }

  const documentNodeActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/nodes\/document\/([^/]+)$/);
  if (request.method === "POST" && documentNodeActionMatch) {
    const profileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(documentNodeActionMatch[1]);
    const action = decodeURIComponent(documentNodeActionMatch[2]);
    const project = await getProjectById(runtimeHome, profileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }

    const body = await readJsonBody(request);
    let payload;

    switch (action) {
      case "create":
        payload = await createDocumentNode(
          project.rootPath,
          project.contentRoots,
          body.path ?? "",
          body.content ?? "",
        );
        break;
      case "duplicate":
        payload = await duplicateDocumentNode(
          project.rootPath,
          project.contentRoots,
          body.sourcePath ?? "",
          body.targetPath ?? "",
        );
        break;
      case "move":
        payload = await moveDocumentNode(
          project.rootPath,
          project.contentRoots,
          body.sourcePath ?? "",
          body.targetPath ?? "",
        );
        break;
      case "rename":
        payload = await renameDocumentNode(
          project.rootPath,
          project.contentRoots,
          body.sourcePath ?? "",
          body.nextName ?? "",
        );
        break;
      case "delete":
        payload = await deleteDocumentNode(project.rootPath, project.contentRoots, body.path ?? "");
        break;
      default:
        sendJson(response, 404, { error: `Unknown document node action: ${action}` });
        return;
    }
    sendJson(response, 200, await createNodeMutationResponse({ projectTreeCache, project, action, payload }));
    return;
  }

  const directoryNodeActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/nodes\/directory\/([^/]+)$/);
  if (request.method === "POST" && directoryNodeActionMatch) {
    const profileId = url.searchParams.get("profileId") ?? "default";
    const projectId = decodeURIComponent(directoryNodeActionMatch[1]);
    const action = decodeURIComponent(directoryNodeActionMatch[2]);
    const project = await getProjectById(runtimeHome, profileId, projectId);
    if (!project) {
      sendJson(response, 404, { error: `Unknown project: ${projectId}` });
      return;
    }

    if (action !== "create") {
      sendJson(response, 404, { error: `Unknown directory node action: ${action}` });
      return;
    }

    const body = await readJsonBody(request);
    const payload = await createDirectoryNode(project.rootPath, project.contentRoots, body.path ?? "");
    sendJson(response, 200, await createNodeMutationResponse({ projectTreeCache, project, action, payload }));
    return;
  }

  if (await webUiRuntime.handleRequest(request, response, url)) {
    return;
  }

  sendJson(response, 404, { error: `Unknown route: ${request.method} ${url.pathname}` });
}

async function createNodeMutationResponse({ projectTreeCache, project, action, payload }) {
  try {
    const mutation = await projectTreeCache.markMutation(project);
    return {
      ...payload,
      treeStatus: "dirty",
      tree: null,
      ...(action === "delete" ? { confirmedDelete: { ...mutation, path: payload.path, singleUse: true } } : {}),
    };
  } catch {
    return { ...payload, treeStatus: "dirty", tree: null };
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function parseArgs(argv) {
  return {
    port: Number(readOption(argv, "--port") ?? DEFAULT_PORT),
    runtimeHome: readOption(argv, "--runtime-home") ?? defaultRuntimeHome(),
    stateFile: readOption(argv, "--state-file") ?? undefined,
    webMode: readOption(argv, "--web-mode") ?? "dev",
    generation: Number(readOption(argv, "--generation") ?? 0),
    nonce: readOption(argv, "--nonce") ?? "standalone",
  };
}

function readOption(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === name) return argv[index + 1] ?? "";
    if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
  }
  return null;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function queueBridgeShutdown({ server, runtimeHome, stateFile, port }) {
  setTimeout(async () => {
    await stopBridgeServer(server, { runtimeHome, stateFile });
    process.exit(0);
  }, 0);
}
