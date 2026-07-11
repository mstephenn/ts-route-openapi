// Idiomatic Fastify — types come from the FastifyRequest route generic and
// the handler return type.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

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
const app = Fastify();

app.get(
  '/orders/:id',
  async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<Order> => {
    const order = orders.get(req.params.id);
    if (!order) {
      reply.code(404);
      throw new Error('order not found');
    }
    return order;
  },
);

app.get(
  '/orders',
  async (req: FastifyRequest<{ Querystring: { limit?: number } }>): Promise<Order[]> => {
    return [...orders.values()].slice(0, req.query.limit ?? 20);
  },
);

app.post(
  '/orders',
  async (req: FastifyRequest<{ Body: CreateOrderInput }>): Promise<Order> => {
    const order: Order = {
      id: `o${orders.size + 1}`,
      productId: req.body.productId,
      quantity: req.body.quantity,
      status: 'pending',
      createdAt: new Date(),
    };
    orders.set(order.id, order);
    return order;
  },
);

app.listen({ port: 3000 }, () => console.log('Fastify example on http://localhost:3000'));
