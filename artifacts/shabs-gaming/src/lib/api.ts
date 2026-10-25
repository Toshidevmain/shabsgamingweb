import shabsPortrait from '@assets/6b693d32-4ba9-4cd2-b89e-3507338d35d5-1.jfif_1792914161697.jpg';

export type Reaction = 'heart' | 'fire' | 'gg';
export type EntityId = string | number;
export type User = { id: EntityId; name: string; email: string; role: string };
export type Comment = { id: EntityId; author: string; content: string; createdAt: string };
export type Post = {
  id: EntityId; title: string; caption: string; game: string; type: 'image' | 'photo' | 'video'; mediaUrl: string;
  createdAt: string; author: { name: string; role: string };
  reactionCounts: Record<Reaction, number>; myReaction: Reaction | null; comments: Comment[];
};
export type FeedResponse = { posts: Post[]; user: User | null; stats: { views: number; highlights: number; community: number } };
export type AuthResponse = { user: User };

const DEMO_KEY = 'shabs-gaming-preview-v1';
const previewEnabled = import.meta.env.DEV;
let usingPreview = false;
export const isPreviewAdapterActive = () => usingPreview;

function initialFeed(): FeedResponse {
  const now = Date.now();
  return {
    user: null, stats: { views: 128400, highlights: 24, community: 1830 },
    posts: [
      { id: 1, title: 'One round. Five clean picks.', caption: 'When the whole squad trusts the call. Special Force Alpha — that final peek was everything.', game: 'Special Force Alpha', type: 'photo', mediaUrl: shabsPortrait, createdAt: new Date(now - 1000 * 60 * 34).toISOString(), author: { name: 'Shabs', role: 'Creator' }, reactionCounts: { heart: 38, fire: 17, gg: 24 }, myReaction: null, comments: [{ id: 31, author: 'Renz', content: 'That crosshair placement is unreal.', createdAt: new Date(now - 1000 * 60 * 22).toISOString() }] },
      { id: 2, title: 'The patience paid off', caption: 'Held the angle, waited for the sound cue, and let the round come to me.', game: 'Special Force Alpha', type: 'photo', mediaUrl: shabsPortrait, createdAt: new Date(now - 1000 * 60 * 60 * 6).toISOString(), author: { name: 'Shabs', role: 'Creator' }, reactionCounts: { heart: 26, fire: 31, gg: 19 }, myReaction: null, comments: [] },
      { id: 3, title: 'A little team chemistry', caption: 'No hero plays needed when everyone makes the right move.', game: 'Community moment', type: 'photo', mediaUrl: shabsPortrait, createdAt: new Date(now - 1000 * 60 * 60 * 27).toISOString(), author: { name: 'Shabs', role: 'Creator' }, reactionCounts: { heart: 51, fire: 12, gg: 33 }, myReaction: null, comments: [] },
    ],
  };
}
function readDemo(): FeedResponse {
  try { const raw = localStorage.getItem(DEMO_KEY); if (raw) return JSON.parse(raw) as FeedResponse; } catch { /* use fresh preview data */ }
  const fresh = initialFeed(); writeDemo(fresh); return fresh;
}
function writeDemo(feed: FeedResponse) { localStorage.setItem(DEMO_KEY, JSON.stringify(feed)); }
function useDemo() { usingPreview = true; }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (previewEnabled) {
    useDemo();
    throw new PreviewRequestError('The PHP API is available in the Docker deployment.');
  }
  try {
    const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers } });
    if (!response.ok) throw new Error(`Request failed (${response.status}). Please try again.`);
    return await response.json() as T;
  } catch (error) {
    throw error instanceof Error ? error : new Error('The service could not be reached.');
  }
}
class PreviewRequestError extends Error { constructor(message: string) { super(message); this.name = 'PreviewRequestError'; } }
function shouldUseDemo(error: unknown) { return previewEnabled && (usingPreview || error instanceof PreviewRequestError); }

export const api = {
  async feed(): Promise<FeedResponse> {
    try { return await request<FeedResponse>('/api/feed'); }
    catch (error) { if (shouldUseDemo(error)) return readDemo(); throw error; }
  },
  async me(): Promise<User | null> {
    try { return (await request<{ user: User | null }>('/api/auth/me')).user; }
    catch (error) { if (shouldUseDemo(error)) return readDemo().user; throw error; }
  },
  async register(input: { name: string; email: string; password: string; setupCode?: string }): Promise<AuthResponse> {
    try { return await request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo(); const user = { id: Date.now(), name: input.name, email: input.email, role: input.setupCode?.trim() ? 'owner' : 'member' };
      feed.user = user; writeDemo(feed); return { user };
    }
  },
  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    try { return await request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo(); const user = { id: 2, name: input.email.split('@')[0] || 'Player', email: input.email, role: 'member' };
      feed.user = user; writeDemo(feed); return { user };
    }
  },
  async logout(): Promise<void> {
    try { await request<{ ok: true }>('/api/auth/logout', { method: 'POST' }); }
    catch (error) { if (!shouldUseDemo(error)) throw error; }
    if (previewEnabled && usingPreview) {
      const feed = readDemo(); feed.user = null; writeDemo(feed);
    }
  },
  async publish(input: { title: string; game: string; caption: string; file: File }): Promise<Post> {
    const body = new FormData(); body.append('title', input.title); body.append('game', input.game); body.append('caption', input.caption); body.append('file', input.file);
    try { return (await request<{ post: Post }>('/api/posts', { method: 'POST', body })).post; }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo(); const post: Post = { id: Date.now(), title: input.title, game: input.game, caption: input.caption, type: input.file.type.startsWith('video/') ? 'video' : 'photo', mediaUrl: URL.createObjectURL(input.file), createdAt: new Date().toISOString(), author: { name: feed.user?.name ?? 'Shabs', role: 'Creator' }, reactionCounts: { heart: 0, fire: 0, gg: 0 }, myReaction: null, comments: [] };
      feed.posts.unshift(post); writeDemo(feed); return post;
    }
  },
  async react(id: EntityId, reaction: Reaction): Promise<Post> {
    try { return (await request<{ post: Post }>(`/api/posts/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) })).post; }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo(); const post = feed.posts.find((item) => item.id === id); if (!post) throw new Error('Highlight not found.');
      if (post.myReaction) post.reactionCounts[post.myReaction] = Math.max(0, post.reactionCounts[post.myReaction] - 1);
      post.myReaction = post.myReaction === reaction ? null : reaction;
      if (post.myReaction) post.reactionCounts[post.myReaction] += 1;
      writeDemo(feed); return post;
    }
  },
  async comment(id: EntityId, content: string): Promise<Comment> {
    try { return (await request<{ comment: Comment }>(`/api/posts/${id}/comments`, { method: 'POST', body: JSON.stringify({ content }) })).comment; }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo(); const post = feed.posts.find((item) => item.id === id); if (!post) throw new Error('Highlight not found.');
      const comment = { id: Date.now(), author: feed.user?.name ?? 'Guest player', content, createdAt: new Date().toISOString() }; post.comments.push(comment); writeDemo(feed); return comment;
    }
  },
  async remove(id: EntityId): Promise<void> {
    try { await request<{ ok: true }>(`/api/posts/${id}`, { method: 'DELETE' }); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo(); feed.posts = feed.posts.filter((post) => post.id !== id); writeDemo(feed);
    }
  },
};
