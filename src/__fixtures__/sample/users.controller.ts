export interface CreateUserInput {
  name: string;
  age?: number;
}

export class UsersController {
  static getById(id: string): { id: string; name: string } {
    return { id, name: 'x' };
  }

  static create(input: CreateUserInput): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
}
