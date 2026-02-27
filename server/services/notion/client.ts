import { Client } from '@notionhq/client';

let notionClient: Client | null = null;

export function getNotionClient(): Client | null {
  if (!process.env.NOTION_API_KEY) {
    console.log('[Notion] NOTION_API_KEY not set, Notion integration disabled');
    return null;
  }

  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
    console.log('[Notion] Client initialized');
  }

  return notionClient;
}

export function isNotionEnabled(): boolean {
  return !!process.env.NOTION_API_KEY && !!process.env.NOTION_CONTENT_DATABASE_ID;
}
