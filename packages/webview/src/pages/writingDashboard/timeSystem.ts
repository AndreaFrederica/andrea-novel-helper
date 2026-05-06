import dayjs from 'dayjs'

/** 时间轴刻度粒度 */
export type TimeUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second'

/** 纪年系统 */
export type CalendarSystem = 'gregorian' | 'lunar' | 'custom'

/** 甘特图布局方向 */
export type GanttLayout = 'gantt' | 'timeline' | 'calendar'

/** 时间轴刻度 */
export interface TimeTick {
  timestamp: number
  label: string
  subLabel?: string | undefined
  isNow: boolean
  isSpecial: boolean
}

/** 时间系统接口 —— 所有时间计算与格式化由此抽象 */
export interface TimeSystem {
  readonly name: string
  /** 短格式，用于时间轴刻度 */
  format(timestamp: number, unit: TimeUnit): string
  /** 完整格式，用于悬浮提示等 */
  formatFull(timestamp: number): string
  /** 日期部分 */
  formatDate(timestamp: number): string
  /** 时间部分 */
  formatTime(timestamp: number): string
  /** 生成以 center 为中心、共 count 个刻度的时间轴 */
  getTicks(center: number, count: number, unit: TimeUnit): TimeTick[]
  /** 时间偏移 */
  add(timestamp: number, amount: number, unit: TimeUnit): number
  /** 时间差 */
  diff(a: number, b: number, unit: TimeUnit): number
  /** 取整到当前粒度 */
  startOf(timestamp: number, unit: TimeUnit): number
}

/* ── 辅助函数 ─────────────────────────────── */

function unitMs(unit: TimeUnit): number {
  const map: Record<TimeUnit, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  }
  return map[unit]
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/* ── 公历（Gregorian）─────────────────────── */

export const gregorianTimeSystem: TimeSystem = {
  name: 'gregorian',

  format(timestamp, unit) {
    const d = dayjs(timestamp)
    switch (unit) {
      case 'year':  return d.format('YYYY')
      case 'month': return d.format('M月')
      case 'week':  return `第${d.format('w')}周`
      case 'day':   return `${d.month() + 1}/${d.date()}`
      case 'hour':  return d.format('HH:mm')
      case 'minute':return d.format('HH:mm')
      case 'second':return d.format('mm:ss')
    }
  },

  formatFull(timestamp) {
    return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
  },

  formatDate(timestamp) {
    return dayjs(timestamp).format('YYYY-MM-DD')
  },

  formatTime(timestamp) {
    return dayjs(timestamp).format('HH:mm:ss')
  },

  getTicks(center, count, unit) {
    const half = Math.floor(count / 2)
    const start = dayjs(center).subtract(half, unit)
    const now = Date.now()
    const threshold = unitMs(unit)

    return Array.from({ length: count }, (_, i) => {
      const d = start.add(i, unit)
      const ts = d.valueOf()
      const weekday = d.day()

      let label: string
      let subLabel: string | undefined

      switch (unit) {
        case 'year':
          label = d.format('YYYY')
          break
        case 'month':
          label = d.format('YYYY')
          subLabel = d.format('M月')
          break
        case 'week':
          label = `第${d.format('w')}周`
          subLabel = d.format('MM-DD')
          break
        case 'day':
          label = `${d.month() + 1}/${d.date()}`
          subLabel = WEEKDAYS[weekday]
          break
        case 'hour':
          label = d.format('HH:mm')
          subLabel = `${d.month() + 1}/${d.date()}`
          break
        case 'minute':
          label = d.format('HH:mm')
          subLabel = d.format('ss')
          break
        case 'second':
          label = d.format('HH:mm:ss')
          break
      }

      return {
        timestamp: ts,
        label,
        subLabel,
        isNow: Math.abs(ts - now) < threshold,
        isSpecial: weekday === 0 || weekday === 6
      }
    })
  },

  add(timestamp, amount, unit) {
    return dayjs(timestamp).add(amount, unit).valueOf()
  },

  diff(a, b, unit) {
    return dayjs(a).diff(b, unit)
  },

  startOf(timestamp, unit) {
    return dayjs(timestamp).startOf(unit).valueOf()
  }
}

/* ── 农历（Lunar）—— 预留接口，目前回退到公历 ── */

export const lunarTimeSystem: TimeSystem = {
  ...gregorianTimeSystem,
  name: 'lunar',
  formatFull(timestamp) {
    // 预留：后续接入 lunar-javascript 等农历库
    return `【农历】${gregorianTimeSystem.formatDate(timestamp)}`
  },
  formatDate(timestamp) {
    return `【农历】${gregorianTimeSystem.formatDate(timestamp)}`
  }
}

/* ── 自定义纪年（Custom）—— 预留接口 ─────────── */

export const customTimeSystem: TimeSystem = {
  ...gregorianTimeSystem,
  name: 'custom',
  formatFull(timestamp) {
    // 预留：后续接入自定义纪元配置
    return `【纪元】${gregorianTimeSystem.formatFull(timestamp)}`
  },
  formatDate(timestamp) {
    return `【纪元】${gregorianTimeSystem.formatDate(timestamp)}`
  }
}

/* ── 工厂函数 ─────────────────────────────── */

export function getTimeSystem(calendar: CalendarSystem): TimeSystem {
  switch (calendar) {
    case 'lunar':  return lunarTimeSystem
    case 'custom': return customTimeSystem
    default:       return gregorianTimeSystem
  }
}

/* ── 视图辅助 ─────────────────────────────── */

/** 根据时间单位获取推荐列宽（像素） */
export function getColWidth(unit: TimeUnit): number {
  const map: Record<TimeUnit, number> = {
    year:  80,
    month: 70,
    week:  80,
    day:   56,
    hour:  60,
    minute: 48,
    second: 56
  }
  return map[unit]
}

/** 根据时间单位获取默认视图刻度数量 */
export function getDefaultSpan(unit: TimeUnit): number {
  const map: Record<TimeUnit, number> = {
    year:  10,
    month: 12,
    week:  12,
    day:   31,
    hour:  24,
    minute: 60,
    second: 60
  }
  return map[unit]
}

/** 根据时间单位获取导航步长（左右箭头偏移多少个刻度） */
export function getNavStep(unit: TimeUnit): number {
  const map: Record<TimeUnit, number> = {
    year:  5,
    month: 6,
    week:  4,
    day:   7,
    hour:  6,
    minute: 15,
    second: 15
  }
  return map[unit]
}

/** 将日期字符串或时间戳统一转为时间戳 */
export function toTimestamp(value: string | number | undefined, fallback: string): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ts = new Date(value).getTime()
    if (!isNaN(ts)) return ts
  }
  return new Date(fallback).getTime()
}

/** 将时间戳转为 datetime-local 输入框用的字符串 */
export function toDateTimeLocal(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 将 datetime-local 字符串转为时间戳 */
export function fromDateTimeLocal(value: string): number {
  return new Date(value).getTime()
}
