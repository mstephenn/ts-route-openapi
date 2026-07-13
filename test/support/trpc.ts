/** Minimal ambient stubs for a tRPC-shaped router/procedure builder, for use in in-memory test fixtures. */
export const TRPC_STUBS = `
  declare const z: any;
  interface ProcedureBuilder {
    use(middleware: (...args: any[]) => unknown): ProcedureBuilder;
    input(schema: unknown): ProcedureBuilder;
    output(schema: unknown): ProcedureBuilder;
    query(resolver: (...args: any[]) => unknown): unknown;
    mutation(resolver: (...args: any[]) => unknown): unknown;
  }
  declare const procedure: ProcedureBuilder;
  declare function router<T>(procedures: T): T;
  declare class TRPCError {
    constructor(opts: { code: string; message?: string });
  }
`;
