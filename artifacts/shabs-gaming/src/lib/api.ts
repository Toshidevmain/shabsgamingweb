import shabsPortrait from '@assets/6b693d32-4ba9-4cd2-b89e-3507338d35d5-1.jfif_1792914161697.jpg';

export type Reaction = 'heart' | 'fire' | 'gg';
export type EntityId = string | number;
export type User = { id: EntityId; name: string; email: string; role: string; username: string; bio: string; avatarUrl: string | null; banned?: boolean };
export type AdminUser = { id: EntityId; name: string; email: string; role: string; username: string; banned: boolean; createdAt: string };
export type Comment = { id: EntityId; author: string; content: string; createdAt: string };
export type Post = {
  id: EntityId; title: string; caption: string; game: string; type: 'image' | 'photo' | 'video'; mediaUrl: string;
  createdAt: string; author: { name: string; role: string; username?: string; avatarUrl?: string | null };
  reactionCounts: Record<Reaction, number>; myReaction: Reaction | null; comments: Comment[];
};
export type FeedResponse = { posts: Post[]; user: User | null; stats: { views: number; highlights: number; community: number } };
export type AuthResponse = { user: User };

const previewEnabled = import.meta.env.DEV;
let usingPreview = false;
let demoFeed: FeedResponse | null = null;
let demoUsers: AdminUser[] | null = null;
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

function persistDemo() {
  try { window.name = 'shabs-demo:' + JSON.stringify({ feed: demoFeed, users: demoUsers }); } catch {  }
}

function readDemo(): FeedResponse {
  if (!demoFeed) {
    try {
      const parsed = JSON.parse(window.name.startsWith('shabs-demo:') ? window.name.slice('shabs-demo:'.length) : '{}');
      demoFeed = (parsed.feed ?? initialFeed()) as FeedResponse;
      demoUsers = (parsed.users ?? null) as AdminUser[] | null;
    } catch {
      demoFeed = initialFeed();
    }
  }
  if (demoFeed!.user) demoFeed!.user = Object.assign({ username: '', bio: '', avatarUrl: null, banned: false }, demoFeed!.user);
  return demoFeed!;
}

function writeDemo(feed: FeedResponse) { demoFeed = feed; persistDemo(); }

function readDemoUsers(): AdminUser[] {
  if (!demoUsers) {
    readDemo();
  }
  if (!demoUsers) {
    demoUsers = [
      { id: 1, name: 'Shabs', email: 'admin@shabs.gaming', role: 'owner', username: 'shabs', banned: false, createdAt: new Date().toISOString() },
      { id: 2, name: 'Renz', email: 'renz@example.com', role: 'member', username: 'renz', banned: false, createdAt: new Date().toISOString() },
    ];
  }
  return demoUsers!;
}

function writeDemoUsers(users: AdminUser[]) { demoUsers = users; persistDemo(); }


function demoUserByEmail(email: string) {
  return readDemoUsers().find((item) => item.email.toLowerCase() === email.trim().toLowerCase());
}

function currentDemoUserBanned(user: User | null): boolean {
  if (!user) return false;
  const found = readDemoUsers().find((item) => String(item.id) === String(user.id) || item.email.toLowerCase() === user.email.toLowerCase());
  return Boolean(found?.banned);
}

function useDemo() { usingPreview = true; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (previewEnabled) {
    useDemo();
    throw new Error('preview');
  }
  const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers } });
  const text = await response.text();
  let payload: T & { error?: string };
  try { payload = JSON.parse(text) as T & { error?: string }; }
  catch { throw new Error('The API server is unavailable. Deploy the backend (Docker/Render) to use the app.'); }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}). Please try again.`);
  return payload;
}

function shouldUseDemo(error: unknown) { return previewEnabled && (usingPreview || (error instanceof Error && error.message === 'preview')); }

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the selected photo.'));
    reader.onerror = () => reject(new Error('Could not read the selected photo.'));
    reader.readAsDataURL(file);
  });
}

export const api = {
  async feed(): Promise<FeedResponse> {
    try { return await request<FeedResponse>('/api/feed'); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo();
      if (feed.user && currentDemoUserBanned(feed.user)) {
        feed.user = null;
        writeDemo(feed);
      }
      return feed;
    }
  },
  async me(): Promise<User | null> {
    try { return (await request<{ user: User | null }>('/api/auth/me')).user; }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo();
      if (feed.user && currentDemoUserBanned(feed.user)) {
        feed.user = null;
        writeDemo(feed);
        return null;
      }
      return feed.user;
    }
  },
  async register(input: { name: string; email: string; password: string }): Promise<AuthResponse> {
    try { return await request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo(); const user: User = { id: Date.now(), name: input.name, email: input.email, role: 'member', username: '', bio: '', avatarUrl: null };
      const users = readDemoUsers();
      if (users.some((item) => item.email.toLowerCase() === user.email.toLowerCase())) {
        throw new Error('An account with this email already exists.');
      }
      users.push({ id: user.id as EntityId, name: user.name, email: user.email, role: 'member', username: '', banned: false, createdAt: new Date().toISOString() });
      writeDemoUsers(users);
      feed.user = user; writeDemo(feed);
      return { user };
    }
  },
  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    try { return await request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo();
      const existing = demoUserByEmail(input.email);
      if (existing?.banned) {
        throw new Error('This account has been banned.');
      }
      const isAdmin = input.email.trim().toLowerCase() === 'admin@shabs.gaming';
      const user: User = { id: existing?.id ?? 2, name: existing?.name ?? (input.email.split('@')[0] || 'Player'), email: input.email, role: existing?.role ?? (isAdmin ? 'owner' : 'member'), username: existing?.username ?? (isAdmin ? 'shabs' : ''), bio: isAdmin ? 'Competitive player, community moderator, and the person behind the highlights.' : '', avatarUrl: null };
      const users = readDemoUsers();
      if (!users.some((item) => item.email.toLowerCase() === user.email.toLowerCase())) {
        users.push({ id: user.id as EntityId, name: user.name, email: user.email, role: user.role, username: user.username, banned: false, createdAt: new Date().toISOString() });
        writeDemoUsers(users);
      }
      feed.user = user; writeDemo(feed);
      return { user };
    }
  },
  async updateProfile(input: { name: string; username: string; bio: string; avatar?: File }): Promise<User> {
    const body = new FormData();
    body.append('name', input.name);
    body.append('username', input.username);
    body.append('bio', input.bio);
    if (input.avatar) body.append('avatar', input.avatar);
    try { return (await request<{ user: User }>('/api/auth/profile', { method: 'POST', body })).user; }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const feed = readDemo();
      if (!feed.user) throw new Error('Sign in before editing your profile.');
      let avatarUrl = feed.user.avatarUrl;
      if (input.avatar) {
        if (input.avatar.size > 1_500_000) throw new Error('Local preview profile photos must be 1.5 MB or smaller.');
        avatarUrl = await fileAsDataUrl(input.avatar);
      }
      const user: User = { ...feed.user, name: input.name, username: input.username, bio: input.bio, avatarUrl };
      feed.user = user; writeDemo(feed); return user;
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
  async adminUsers(): Promise<AdminUser[]> {
    try { return (await request<{ users: AdminUser[] }>('/api/admin/users')).users; }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      return readDemoUsers();
    }
  },
  async banUser(id: EntityId, banned: boolean): Promise<void> {
    try { await request<{ user: AdminUser }>(`/api/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned }) }); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      const users = readDemoUsers().map((item) => item.id === id ? { ...item, banned } : item);
      writeDemoUsers(users);
      if (banned) {
        const feed = readDemo();
        if (feed.user && users.find((item) => String(item.id) === String(feed.user!.id))?.banned) {
          feed.user = null;
          writeDemo(feed);
        }
      }
    }
  },
  async deleteUser(id: EntityId): Promise<void> {
    try { await request<{ ok: true }>(`/api/admin/users/${id}`, { method: 'DELETE' }); }
    catch (error) {
      if (!shouldUseDemo(error)) throw error;
      writeDemoUsers(readDemoUsers().filter((item) => item.id !== id));
      const feed = readDemo();
      if (feed.user && String(feed.user.id) === String(id)) {
        feed.user = null;
        writeDemo(feed);
      }
    }
  },
};
