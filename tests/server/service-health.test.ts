import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import { startBridgeServer, stopBridgeServer } from '../../server/bridge-server.mjs'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('bridge service health', () => {
  it('returns identity without reading the project registry', async () => {
    const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'md-reader-health-'))
    const port = await getAvailablePort()
    await writeFile(path.join(runtimeHome, 'projects.json'), '{broken json', 'utf8')
    const server = await startBridgeServer({
      runtimeHome,
      port,
      webMode: 'none',
      generation: 7,
      nonce: 'test-nonce',
    })
    cleanups.push(async () => {
      await stopBridgeServer(server, { runtimeHome })
      await rm(runtimeHome, { recursive: true, force: true })
    })

    const response = await fetch(`http://127.0.0.1:${port}/api/health`)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      serviceId: 'md-reader-bridge',
      mode: 'local-service',
      projectsLoaded: null,
      port,
      generation: 7,
      nonce: 'test-nonce',
    })
  })

  it('binds the loopback host by default', async () => {
    const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'md-reader-health-host-'))
    const port = await getAvailablePort()
    const server = await startBridgeServer({ runtimeHome, port, webMode: 'none' })
    cleanups.push(async () => {
      await stopBridgeServer(server, { runtimeHome })
      await rm(runtimeHome, { recursive: true, force: true })
    })

    const address = server.address()
    expect(typeof address === 'object' && address ? address.address : null).toBe('127.0.0.1')
  })

  it('accepts an explicit host argument', async () => {
    const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'md-reader-health-host2-'))
    const port = await getAvailablePort()
    const server = await startBridgeServer({ runtimeHome, port, host: '0.0.0.0', webMode: 'none' })
    cleanups.push(async () => {
      await stopBridgeServer(server, { runtimeHome })
      await rm(runtimeHome, { recursive: true, force: true })
    })

    const address = server.address()
    expect(typeof address === 'object' && address ? address.address : null).toBe('0.0.0.0')
  })

  it('surfaces a bind error instead of hanging', async () => {
    const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'md-reader-health-busy-'))
    const port = await getAvailablePort()

    // 先占住端口，再让 bridge 去绑同一个号，应当抛错而不是挂住
    const blocker = net.createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(port, '127.0.0.1', resolve)
    })
    cleanups.push(async () => {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
      await rm(runtimeHome, { recursive: true, force: true })
    })

    await expect(startBridgeServer({ runtimeHome, port, webMode: 'none' })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
  })
})

async function getAvailablePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}
