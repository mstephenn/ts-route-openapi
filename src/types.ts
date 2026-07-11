import type {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node,
  Type,
} from 'ts-morph';

export type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** A route registration found in source: verb + path + the handler expression node. */
export interface RouteBinding {
  verb: HttpVerb;
  path: string;
  handlerExpression: Node;
}

/** Any function-like declaration a route can bind to. */
export type RouteHandler =
  | MethodDeclaration
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression;

/** A binding resolved to the handler that implements it. */
export interface ResolvedRoute {
  verb: HttpVerb;
  path: string;
  controllerName: string;
  handlerName: string;
  method: RouteHandler;
}

export interface ParamType {
  name: string;
  /** Omitted means "no static type information" — documented as a string. */
  type?: Type;
}

/** One documented response: a status code and (optionally) its payload type. */
export interface ResponseType {
  status: number;
  type?: Type;
}

/** Types extracted from a resolved route's handler signature. */
export interface RouteTypes {
  pathParams: ParamType[];
  query: ParamType[];
  body?: Type;
  /** Single-status shorthand: documented as the 200 response when `responses` is absent. */
  response?: Type;
  /** Explicit multi-status responses; takes precedence over `response`. */
  responses?: ResponseType[];
}
