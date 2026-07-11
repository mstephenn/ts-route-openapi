export interface CreateUserInput {
  /** Full display name. */
  name: string;
  age?: number;
}

export class UsersController {
  /**
   * Get a user by id.
   * Returns the public user profile.
   */
  static getById(id: string): { id: string; name: string } {
    return { id, name: 'x' };
  }

  /** Create a user. */
  static create(input: CreateUserInput): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
}
