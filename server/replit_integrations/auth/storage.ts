import { users, type User, type UpsertUser } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByWorkosId(workosUserId: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByWorkosId(workosUserId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.workosUserId, workosUserId));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = await this.getUser(userData.id as string);
    
    let username = existingUser?.username || userData.username;
    if (!username) {
      const randomSuffix = require('crypto').randomBytes(2).toString('hex');
      if (userData.firstName || userData.lastName) {
        const baseName = `${userData.firstName || ''}${userData.lastName || ''}`.replace(/\s+/g, '').toLowerCase();
        username = baseName ? `${baseName}_${randomSuffix}` : `player_${randomSuffix}`;
      } else if (userData.email) {
        const emailBase = userData.email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
        username = `${emailBase}_${randomSuffix}`;
      } else {
        username = `player_${randomSuffix}`;
      }
    }
    
    const [user] = await db
      .insert(users)
      .values({ ...userData, username })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }
}

export const authStorage = new AuthStorage();
