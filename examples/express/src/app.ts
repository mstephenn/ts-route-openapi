// Idiomatic Express — types come from the standard Request/Response generics.
import express, { type Request, type Response } from 'express';

interface CreateOrderInput {
  productId: string;
  quantity: number;
  note?: string;
}

interface Order {
  id: string;
  productId: string;
  quantity: number;
  status: 'pending' | 'shipped' | 'delivered';
  createdAt: Date;
}

const orders = new Map<string, Order>();
const app = express();
app.use(express.json());

app.get('/orders/:id', (req: Request<{ id: string }>, res: Response<Order>) => {
  const order = orders.get(req.params.id);
  if (!order) return void res.status(404).end();
  res.json(order);
});

app.get(
  '/orders',
  (req: Request<object, Order[], unknown, { limit?: string }>, res: Response<Order[]>) => {
    res.json([...orders.values()].slice(0, Number(req.query.limit ?? 20)));
  },
);

app.post('/orders', (req: Request<object, Order, CreateOrderInput>, res: Response<Order>) => {
  const order: Order = {
    id: `o${orders.size + 1}`,
    productId: req.body.productId,
    quantity: req.body.quantity,
    status: 'pending',
    createdAt: new Date(),
  };
  orders.set(order.id, order);
  res.status(201).json(order);
});

app.listen(3000, () => console.log('Express example on http://localhost:3000'));
