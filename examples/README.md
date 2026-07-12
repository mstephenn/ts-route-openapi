# Examples

Each example is a self-contained, **idiomatic** app — no adapters, no
annotations, no code changes for the docs. Install the package, run the CLI,
get the spec. Every committed `openapi.yaml` was produced by `npm run
openapi`, never hand-edited.

| Example | Framework | What gets documented |
| --- | --- | --- |
| [`express/`](./express) | Express 5 | paths, path params, query, body, responses — from `Request<P, ResBody, ReqBody, Query>` / `Response<T>` generics |
| [`fastify/`](./fastify) | Fastify 5 | paths, path params, query, body, responses — from `FastifyRequest<{Params, Body, Querystring}>` + handler return types |
| [`nest/`](./nest) | NestJS 11 | paths, path params, query, body, responses — from `@Controller/@Get/@Param/@Query/@Body` decorators + method signatures |
| [`hono/`](./hono) | Hono 4 | paths, path params, responses — from `c.json()`'s `TypedResponse<T>` |
| [`koa/`](./koa) | Koa 2 + @koa/router | paths and path params (Koa's `ctx` carries no static route types) |
| [`trpc/`](./trpc) | tRPC 11 | synthetic paths, query/body, responses — from `.input(zodSchema)`/`.output(zodSchema)` and resolver return types |
| [`generic/`](./generic) | none | the plain typed-method convention, framework-free |

## Running an example

```sh
cd express          # or fastify / nest / hono / koa / trpc
npm install
npm run openapi     # regenerate openapi.yaml from the source
npm run dev         # boot the real server on :3000
```

```sh
curl -X POST localhost:3000/orders -H 'content-type: application/json' \
  -d '{"productId":"p9","quantity":3}'
curl localhost:3000/orders/o1
```

The `trpc/` example exposes its procedures at synthetic paths instead
(`/trpc/<dotted.path>`, matching what the generated spec documents), not the
REST-shaped URLs above:

```sh
curl -X POST localhost:3000/trpc/orders.create \
  -H 'content-type: application/json' -d '{"productId":"p9","quantity":3}'
curl 'localhost:3000/trpc/orders.getById?input=%7B%22id%22%3A%22o1%22%7D'
```

## How much detail you get depends on the framework

The tool reads whatever static type information the framework's idioms carry:

- **Express / Fastify / NestJS** put request and response types in generics,
  decorators, and signatures — full schemas come out.
- **tRPC** carries request/response schemas in `.input()`/`.output()` Zod
  calls and the resolver's return type — full schemas come out too.
- **Hono** types responses through `c.json()`; params/bodies are typed by
  middleware (validators), which is not yet supported — you get paths, path
  params, and response schemas.
- **Koa** has no static route typing at all — you get correct paths and path
  params, nothing more.

If a handler's types can't be recognized, the tool always falls back to
documenting the route's path and its `:token` params as strings — a spec is
never silently missing a registered route.
