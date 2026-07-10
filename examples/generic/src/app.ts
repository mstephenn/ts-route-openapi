// Framework-agnostic example: any object exposing get/post/put/patch/delete
// registration methods works — ts-route-openapi only reads the call-sites.
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

export class OrdersController {
  static getById(id: string): Promise<Order> {
    return Promise.resolve({
      id,
      productId: 'p1',
      quantity: 1,
      status: 'pending',
      createdAt: new Date(),
    });
  }

  static list(limit: number, verbose: boolean): Promise<Order[]> {
    void limit;
    void verbose;
    return Promise.resolve([]);
  }

  static create(input: CreateOrderInput): Promise<Order> {
    return Promise.resolve({
      id: 'o1',
      productId: input.productId,
      quantity: input.quantity,
      status: 'pending',
      createdAt: new Date(),
    });
  }
}

declare const router: {
  get(path: string, handler: unknown): void;
  post(path: string, handler: unknown): void;
};

router.get('/orders/:id', OrdersController.getById);
router.get('/orders', OrdersController.list);
router.post('/orders', OrdersController.create);
