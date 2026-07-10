import Fastify from 'fastify';
import { createTypedRouter } from './typed-router.js';
import { OrdersController } from './controllers.js';

const app = Fastify();

const router = createTypedRouter(app);

// These registrations are what `npm run openapi` documents.
router.get('/orders/:id', OrdersController.getById);
router.get('/orders', OrdersController.list);
router.post('/orders', OrdersController.create);

app.listen({ port: 3000 }, () => console.log('Fastify example on http://localhost:3000'));
