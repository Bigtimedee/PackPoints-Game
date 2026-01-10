import { db } from "../db";
import { eventLog, type AnalyticsEvent, type AnalyticsEventType } from "@shared/schema";

export interface EventDispatcher {
  dispatch(event: AnalyticsEvent): Promise<void>;
}

class DatabaseEventDispatcher implements EventDispatcher {
  async dispatch(event: AnalyticsEvent): Promise<void> {
    try {
      await db.insert(eventLog).values({
        eventType: event.eventType,
        userId: event.userId || null,
        sessionId: event.sessionId || null,
        metadata: event.metadata || null,
      });
    } catch (error) {
      console.error("Failed to log analytics event:", error);
    }
  }
}

class CompositeEventDispatcher implements EventDispatcher {
  private dispatchers: EventDispatcher[] = [];

  addDispatcher(dispatcher: EventDispatcher): void {
    this.dispatchers.push(dispatcher);
  }

  async dispatch(event: AnalyticsEvent): Promise<void> {
    await Promise.all(
      this.dispatchers.map(d => d.dispatch(event).catch(err => {
        console.error("Event dispatcher error:", err);
      }))
    );
  }
}

class AnalyticsService {
  private dispatcher: CompositeEventDispatcher;

  constructor() {
    this.dispatcher = new CompositeEventDispatcher();
    this.dispatcher.addDispatcher(new DatabaseEventDispatcher());
  }

  addDispatcher(dispatcher: EventDispatcher): void {
    this.dispatcher.addDispatcher(dispatcher);
  }

  async track(
    eventType: AnalyticsEventType,
    userId?: string | null,
    metadata?: Record<string, unknown>,
    sessionId?: string | null
  ): Promise<void> {
    await this.dispatcher.dispatch({
      eventType,
      userId,
      sessionId,
      metadata,
    });
  }

  async storeViewed(userId?: string | null, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("store_viewed", userId, metadata);
  }

  async purchaseStarted(userId: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("purchase_started", userId, metadata);
  }

  async purchaseCompleted(userId: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("purchase_completed", userId, metadata);
  }

  async matchStarted(userId: string | null, sessionId: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("match_started", userId, metadata, sessionId);
  }

  async matchCompleted(userId: string | null, sessionId: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("match_completed", userId, metadata, sessionId);
  }

  async ptsEarned(userId: string, amount: number, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("pts_earned", userId, { amount, ...metadata });
  }

  async ptsSpent(userId: string, amount: number, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("pts_spent", userId, { amount, ...metadata });
  }

  async redeemStarted(userId: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("redeem_started", userId, metadata);
  }

  async redeemCompleted(userId: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.track("redeem_completed", userId, metadata);
  }
}

export const analyticsService = new AnalyticsService();
