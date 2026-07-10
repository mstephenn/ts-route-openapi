export interface CreateOrderInput {
  productId: string;
  quantity: number;
  note?: string;
}

export interface Order {
  id: string;
  productId: string;
  quantity: number;
  status: 'pending' | 'shipped' | 'delivered';
  createdAt: Date;
}

const orders = new Map<string, Order>();

export class OrdersController {
  static getById(id: string): Order | undefined {
    return orders.get(id);
  }

  static list(limit: number, verbose: boolean): Order[] {
    void verbose;
    return [...orders.values()].slice(0, limit || 20);
  }

  static create(input: CreateOrderInput): Order {
    const order: Order = {
      id: `o${orders.size + 1}`,
      productId: input.productId,
      quantity: input.quantity,
      status: 'pending',
      createdAt: new Date(),
    };
    orders.set(order.id, order);
    return order;
  }
}
