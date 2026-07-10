import type { MethodDeclaration, Node, Type } from 'ts-morph';

export type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** A route registration found in source: verb + path + the handler expression node. */
export interface RouteBinding {
  verb: HttpVerb;
  path: string;
  handlerExpression: Node;
}

/** A binding resolved to the controller method that implements it. */
export interface ResolvedRoute {
  verb: HttpVerb;
  path: string;
  controllerName: string;
  handlerName: string;
  method: MethodDeclaration;
}

export interface ParamType {
  name: string;
  type: Type;
}

/** Types extracted from a resolved route's method signature. */
export interface RouteTypes {
  pathParams: ParamType[];
  query: ParamType[];
  body?: Type;
  response?: Type;
}
