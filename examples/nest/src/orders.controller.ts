// Idiomatic NestJS — routes come from @Controller/@Get/@Post decorators,
// types from the @Param/@Query/@Body decorated method signature.
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

export class CreateOrderDto {
  productId!: string;
  quantity!: number;
  note?: string;
}

export interface Order {
  id: string;
  productId: string;
  quantity: number;
  status: 'pending' | 'shipped' | 'delivered';
}

const orders = new Map<string, Order>();

@Controller('orders')
export class OrdersController {
  @Get(':id')
  getById(@Param('id') id: string): Order {
    return orders.get(id) ?? { id, productId: 'p1', quantity: 1, status: 'pending' };
  }

  @Get()
  list(@Query('limit') limit?: number): Order[] {
    return [...orders.values()].slice(0, limit ?? 20);
  }

  @Post()
  create(@Body() input: CreateOrderDto): Order {
    const order: Order = {
      id: `o${orders.size + 1}`,
      productId: input.productId,
      quantity: input.quantity,
      status: 'pending',
    };
    orders.set(order.id, order);
    return order;
  }
}
