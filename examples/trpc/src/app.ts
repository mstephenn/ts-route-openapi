// Idiomatic tRPC — procedures (not HTTP call-sites) carry the route info:
// `.input(zodSchema)` documents the request, the resolver's return type (or
// an explicit `.output(zodSchema)`) documents the response. Every procedure
// is exposed at POST/GET <base>/<dotted.path>, matching tRPC's HTTP adapter.
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

interface Order {
  id: string;
  productId: string;
  quantity: number;
  status: 'pending' | 'shipped' | 'delivered';
}

const orders = new Map<string, Order>();
const t = initTRPC.create();
const router = t.router;
const publicProcedure = t.procedure;

const appRouter = router({
  orders: router({
    getById: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(({ input }): Order => {
        return (
          orders.get(input.id) ?? {
            id: input.id,
            productId: 'p1',
            quantity: 1,
            status: 'pending',
          }
        );
      }),
    create: publicProcedure
      .input(z.object({ productId: z.string(), quantity: z.number() }))
      .mutation(({ input }): Order => {
        const order: Order = {
          id: `o${orders.size + 1}`,
          productId: input.productId,
          quantity: input.quantity,
          status: 'pending',
        };
        orders.set(order.id, order);
        return order;
      }),
  }),
});

export type AppRouter = typeof appRouter;

createHTTPServer({ router: appRouter }).listen(3000);
console.log('tRPC example on http://localhost:3000');
