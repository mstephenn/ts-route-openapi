// Idiomatic Hono — the response type rides in c.json()'s TypedResponse;
// path params are documented from the route's :tokens.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

interface Order {
  id: string;
  productId: string;
  quantity: number;
  status: 'pending' | 'shipped' | 'delivered';
}

const orders = new Map<string, Order>();
const app = new Hono();

app.get('/orders/:id', (c) => {
  const order: Order = orders.get(c.req.param('id')) ?? {
    id: c.req.param('id'),
    productId: 'p1',
    quantity: 1,
    status: 'pending',
  };
  return c.json(order);
});

app.post('/orders', async (c) => {
  const input = await c.req.json<{ productId: string; quantity: number }>();
  const order: Order = {
    id: `o${orders.size + 1}`,
    productId: input.productId,
    quantity: input.quantity,
    status: 'pending',
  };
  orders.set(order.id, order);
  return c.json(order);
});

serve({ fetch: app.fetch, port: 3000 }, () => console.log('Hono example on http://localhost:3000'));
