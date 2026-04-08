import { getMusicUrl } from '../api/song'
import { getPreferredQuality } from './quality'

const ADVANCED_QUALITY_LEVELS = new Set(['jyeffect', 'sky', 'dolby', 'jymaster'])
const LINEAR_FALLBACK_ORDER = ['hires', 'lossless', 'exhigh', 'higher', 'standard']
const LINEAR_LEVEL_RANK = new Map(LINEAR_FALLBACK_ORDER.map((level, index) => [level, index]))
const IPHONE_PLAYBACK_REQUEST_PARAMS = Object.freeze({
    ua: 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)',
    cookie: 'os=iPhone OS; appver=9.0.90; osver=16.2; channel=distribution',
})
function extractTrackInfo(songInfo) {
    return songInfo && songInfo.data && songInfo.data[0] ? songInfo.data[0] : null
}

function normalizeTrackInfo(trackInfo) {
    if (!trackInfo) return null
    const normalizedUrl = trackInfo.proxyUrl || trackInfo.url || ''
    return {
        ...trackInfo,
        url: normalizedUrl,
    }
}

function isTrialTrack(trackInfo) {
    const freeTrialInfo = trackInfo?.freeTrialInfo
    return freeTrialInfo !== null && freeTrialInfo !== undefined && freeTrialInfo !== 'null'
}

function isPlayableTrack(trackInfo) {
    return !!(trackInfo && trackInfo.url && !isTrialTrack(trackInfo))
}

function getTrackLevel(trackInfo) {
    return typeof trackInfo?.level === 'string' ? trackInfo.level : ''
}

function isLinearFallbackMatch(requestedLevel, actualLevel) {
    const requestedRank = LINEAR_LEVEL_RANK.get(requestedLevel)
    const actualRank = LINEAR_LEVEL_RANK.get(actualLevel)
    if (requestedRank === undefined || actualRank === undefined) return false
    // 例如请求 hires，返回 lossless/exhigh 也视为命中（按链路向下自动降级）。
    return actualRank >= requestedRank
}

function getPlaybackRequestParams(preferredLevel) {
    if (!ADVANCED_QUALITY_LEVELS.has(preferredLevel)) return {}
    return IPHONE_PLAYBACK_REQUEST_PARAMS
}

async function requestTrack(id, level, requestParams = {}) {
    const songInfo = await getMusicUrl(id, level, requestParams)
    return normalizeTrackInfo(extractTrackInfo(songInfo))
}

async function requestUnblockedTrack(id, level, requestParams = {}) {
    // 统一复用服务端全局解灰，避免 /song/url/v1?unblock=true 命中依赖包里写死的源顺序。
    return requestTrack(id, level, requestParams)
}

export async function resolveTrackByQualityPreference(id, preferredLevel) {
    const normalizedPreferredLevel = getPreferredQuality(preferredLevel)
    const playbackRequestParams = getPlaybackRequestParams(normalizedPreferredLevel)
    const preferredTrack = await requestTrack(id, normalizedPreferredLevel, playbackRequestParams)

    if (!ADVANCED_QUALITY_LEVELS.has(normalizedPreferredLevel)) {
        if (isPlayableTrack(preferredTrack)) return preferredTrack
        return requestUnblockedTrack(id, normalizedPreferredLevel, playbackRequestParams)
    }
    if (isPlayableTrack(preferredTrack) && getTrackLevel(preferredTrack) === normalizedPreferredLevel) {
        return preferredTrack
    }

    let firstPlayableFallbackTrack = null
    for (const fallbackLevel of LINEAR_FALLBACK_ORDER) {
        const fallbackTrack = await requestTrack(id, fallbackLevel, playbackRequestParams)
        if (!isPlayableTrack(fallbackTrack)) continue

        if (!firstPlayableFallbackTrack) firstPlayableFallbackTrack = fallbackTrack
        if (isLinearFallbackMatch(fallbackLevel, getTrackLevel(fallbackTrack))) return fallbackTrack
    }

    if (firstPlayableFallbackTrack) return firstPlayableFallbackTrack
    if (isPlayableTrack(preferredTrack)) return preferredTrack
    return requestUnblockedTrack(id, normalizedPreferredLevel, playbackRequestParams)
}
