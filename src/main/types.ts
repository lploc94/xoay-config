// Re-export all types from shared module.
// This file exists for backward compatibility — prefer importing from '../shared/types'.
export {
  type BaseConfigItem,
  type FileReplaceItem,
  type EnvVarItem,
  type RunCommandItem,
  type ConfigItem,
  type Profile,
  type Preset,
  type ItemResult,
  type SwitchResult,
  type AppState,
  type IpcResponse,
  type CreateProfileReq,
  IPC_CHANNELS
} from '../shared/types'
