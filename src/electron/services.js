const http = require('http')

// 尝试加载增强版API（新包名）
let enhancedApi = null;
try {
    enhancedApi = require('@neteasecloudmusicapienhanced/api');
} catch (error) {
    console.log('增强版API加载失败:', error.message);
}

const API_PORT = 36530
const API_READY_TIMEOUT_MS = 12000
const API_READY_POLL_INTERVAL_MS = 150
const API_READY_SETTLE_DELAY_MS = 250
const DEFAULT_UNBLOCK_SOURCE = 'pyncmd,qq,bodian,migu,kugou,kuwo'

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForServerListening(server, timeoutMs = 4000) {
    if (!server || server.listening) return Promise.resolve()

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup()
            reject(new Error('ncm-api-listen-timeout'))
        }, timeoutMs)

        const cleanup = () => {
            clearTimeout(timer)
            server.off('listening', onListening)
            server.off('error', onError)
        }

        const onListening = () => {
            cleanup()
            resolve()
        }

        const onError = (error) => {
            cleanup()
            reject(error)
        }

        server.once('listening', onListening)
        server.once('error', onError)
    })
}

function probeServer(url, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            res.resume()
            resolve(res.statusCode || 200)
        })

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('ncm-api-probe-timeout'))
        })

        req.on('error', reject)
    })
}

async function waitForApiReachable(url, timeoutMs = API_READY_TIMEOUT_MS, intervalMs = API_READY_POLL_INTERVAL_MS) {
    const deadline = Date.now() + timeoutMs
    let lastError = null

    while (Date.now() < deadline) {
        try {
            await probeServer(url)
            return
        } catch (error) {
            lastError = error
            await delay(intervalMs)
        }
    }

    throw lastError || new Error('ncm-api-unreachable')
}

function applyDefaultNcmApiEnv() {
    // 仅在未显式配置时补默认值，保持外部环境仍可覆盖。
    if (!process.env.ENABLE_GENERAL_UNBLOCK) {
        process.env.ENABLE_GENERAL_UNBLOCK = 'true'
    }
    // 按优先级串行匹配，避免 Promise.any 抢到更快但不稳定的坏流。
    if (!process.env.FOLLOW_SOURCE_ORDER) {
        process.env.FOLLOW_SOURCE_ORDER = 'true'
    }
    if (!process.env.UNBLOCK_SOURCE) {
        process.env.UNBLOCK_SOURCE = DEFAULT_UNBLOCK_SOURCE
    }
}

//启动网易云音乐API（可选）
module.exports = async function startNeteaseMusicApi() {
    if (enhancedApi && enhancedApi.serveNcmApi) {
        try {
            applyDefaultNcmApiEnv()
            const appExt = await enhancedApi.serveNcmApi({
                checkVersion: false,
                port: API_PORT,
            });
            await waitForServerListening(appExt && appExt.server)
            await waitForApiReachable(`http://127.0.0.1:${API_PORT}/`)
            await delay(API_READY_SETTLE_DELAY_MS)
            return { ready: true };
        } catch (error) {
            const errorMessage = error && error.message ? error.message : 'unknown error';
            console.log('API服务器启动失败:', errorMessage);
            return { ready: false, error: errorMessage };
        }
    }
    const errorMessage = 'NCM API module unavailable';
    console.log('NCM API 模块不可用，后续请求可能失败');
    return { ready: false, error: errorMessage };
}
