declare module 'sql.js' {
  interface InitSqlJsConfig {
    locateFile?: (file: string, prefix: string) => string
  }

  const initSqlJs: (config?: InitSqlJsConfig) => Promise<any>
  export default initSqlJs
}
