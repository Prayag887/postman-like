export interface KeyValue { key: string; value: string; enabled: boolean }
export interface ApiRequest { id: string; collection_id: string; folder_path: string[]; name: string; method: string; url: string; headers: KeyValue[]; query: KeyValue[]; body_kind: string; body?: string; disabled: boolean }
export interface Collection { id: string; name: string; requests: ApiRequest[]; variables: KeyValue[]; imported_at: string; import_warnings: string[] }
export interface Difference { kind: string; path: string; baseline?: unknown; current?: unknown; message: string }
export interface ResponseComparison { changed: boolean; differences: Difference[] }
export interface ResponseSnapshot { status: number; headers: KeyValue[]; content_type?: string; body: string; body_size: number; duration_ms: number; truncated: boolean }
export interface Execution { id: string; request_id: string; request_name: string; state: string; response?: ResponseSnapshot; error?: string; comparison?: ResponseComparison }
export interface Run { id: string; collection_id: string; collection_name: string; environment_name?: string; started_at: string; completed_at?: string; state: string; baseline_run_id?: string; executions: Execution[] }
