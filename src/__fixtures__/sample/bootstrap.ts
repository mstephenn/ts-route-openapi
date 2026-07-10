import { UsersController } from './users.controller.js';

declare const app: {
  get(path: string, handler: unknown): void;
  post(path: string, handler: unknown): void;
};

app.get('/users/:id', UsersController.getById);
app.post('/users', UsersController.create);
