// Idiomatic Koa + @koa/router — Koa's Context carries no static route types,
// so paths and :token params are documented (as strings); bodies/responses
// are not statically recoverable.
import Router from '@koa/router';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';

interface Order {
  id: string;
  productId: string;
  quantity: number;
}

const orders = new Map<string, Order>();
const app = new Koa();
const router = new Router();

router.get('/orders/:id', (ctx) => {
  ctx.body = orders.get(ctx.params.id) ?? { id: ctx.params.id, productId: 'p1', quantity: 1 };
});

router.post('/orders', (ctx) => {
  const input = ctx.request.body as { productId: string; quantity: number };
  const order: Order = { id: `o${orders.size + 1}`, productId: input.productId, quantity: input.quantity };
  orders.set(order.id, order);
  ctx.status = 201;
  ctx.body = order;
});

app.use(bodyParser());
app.use(router.routes());
app.listen(3000, () => console.log('Koa example on http://localhost:3000'));
