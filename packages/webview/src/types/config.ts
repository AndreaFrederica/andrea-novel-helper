export interface ConfigItem {
  id: string
  type: 'string' | 'boolean' | 'number' | 'integer' | 'array'
  name: string
  description: string
  value: any
  defaultValue: any
  enum?: string[]
  enumDescriptions?: string[]
  minimum?: number
  maximum?: number
  section?: string
  quickSetting?: boolean
}