import express from 'express';
import { createTypedRouter } from './typed-router.js';
import { OrdersController } from './controllers.js';

const app = express();
app.use(express.json());

const router = createTypedRouter(app);

// These registrations are what `npm run openapi` documents.
router.get('/orders/:id', OrdersController.getById);
router.get('/orders', OrdersController.list);
router.post('/orders', OrdersController.create);

app.listen(3000, () => console.log('Express example on http://localhost:3000'));
