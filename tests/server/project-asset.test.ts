import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { readProjectAsset } from '../../server/project-asset.mjs'
import { startBridgeServer, stopBridgeServer } from '../../server/bridge-server.mjs'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })

it('serves image bytes and HEAD headers, rejects traversal, unsupported types and symlink escapes', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'md-assets-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const root = path.join(home, 'project'), assets = path.join(root, 'assets')
  await mkdir(assets, { recursive: true })
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3])
  await writeFile(path.join(assets, '人物 #1.jpg'), jpeg)
  await writeFile(path.join(assets, 'test.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(path.join(root, 'secret.jpg'), jpeg)
  const outside = path.join(home, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'secret.jpg'), jpeg)
  await symlink(outside, path.join(assets, 'escape'), 'junction')
  await expect(readProjectAsset(root, ['assets'], 'assets/escape/secret.jpg')).rejects.toMatchObject({ status: 403 })
  await expect(readProjectAsset(root, ['assets'], 'secret.jpg')).rejects.toMatchObject({ status: 403 })
  await expect(readProjectAsset(root, ['../outside'], 'assets/人物 #1.jpg')).rejects.toMatchObject({ status: 403 })
  expect((await readProjectAsset(root, ['assets'], 'assets/test.svg')).headers['content-type']).toBe('image/svg+xml')
  const server = await startBridgeServer({ port: 0, runtimeHome: home, webMode: 'none' })
  cleanup.push(() => stopBridgeServer(server, { runtimeHome: home }))
  const base = `http://127.0.0.1:${server.address().port}`
  const registration = await (await fetch(`${base}/api/profiles/test/projects/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootPath: root, expectedRevision: 0 }) })).json()
  const url = (asset: string) => `${base}/api/projects/${registration.project.id}/asset?${new URLSearchParams({ profileId: 'test', path: asset })}`
  const response = await fetch(url('assets/人物 #1.jpg'))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/jpeg')
  expect(response.headers.get('content-length')).toBe(String(jpeg.length))
  expect(response.headers.get('cache-control')).toBe('private, max-age=300')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg)
  const head = await fetch(url('assets/人物 #1.jpg'), { method: 'HEAD' })
  expect(head.status).toBe(200)
  expect(head.headers.get('content-length')).toBe(String(jpeg.length))
  expect(await head.text()).toBe('')
  for (const invalid of ['../../secret.txt', '/etc/passwd', 'C:/Windows/win.ini', 'C:secret.jpg', '..\\secret.jpg']) {
    expect((await fetch(url(invalid))).status, invalid).toBe(400)
  }
  expect((await fetch(url('assets/escape/secret.jpg'))).status).toBe(403)
  expect((await fetch(url('missing.jpg'))).status).toBe(404)
  expect((await fetch(url('secret.html'))).status).toBe(415)
})
