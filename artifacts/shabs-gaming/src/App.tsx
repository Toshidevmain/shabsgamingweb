import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Activity, ChevronDown, CircleAlert, Flame, Heart, ImagePlus, LogIn, MessageCircle, Search, Swords, ThumbsUp, Upload, Users, Video, X, UserRound, Camera } from 'lucide-react';
import shabsPortrait from '@assets/6b693d32-4ba9-4cd2-b89e-3507338d35d5-1.jfif_1792914161697.jpg';
import { api, isPreviewAdapterActive, type EntityId, type FeedResponse, type Post, type Reaction, type User } from '@/lib/api';

const queryClient = new QueryClient();
type Modal = 'auth' | 'publish' | 'profile' | null;
type AuthMode = 'login' | 'register';

function when(date: string) {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }

function App() {
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [gameFilter, setGameFilter] = useState('All highlights');
  const [search, setSearch] = useState('');
  const [expandedComments, setExpandedComments] = useState<EntityId[]>([]);
  const [busyPost, setBusyPost] = useState<EntityId | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<File | undefined>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3600);
  }, []);
  const loadFeed = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const result = await api.feed();
      setFeed(result); setUser(result.user); setPreview(isPreviewAdapterActive());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load the highlights.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void loadFeed();
    void api.me().then((current) => { setUser((existing) => existing ?? current); setPreview(isPreviewAdapterActive()); }).catch(() => undefined);
  }, [loadFeed]);

  const allGames = useMemo(() => ['All highlights', ...Array.from(new Set(feed?.posts.map((post) => post.game) ?? []))], [feed?.posts]);
  const visiblePosts = useMemo(() => (feed?.posts ?? []).filter((post) => {
    const matchesGame = gameFilter === 'All highlights' || post.game === gameFilter;
    const query = search.trim().toLowerCase();
    return matchesGame && (!query || `${post.title} ${post.caption} ${post.game}`.toLowerCase().includes(query));
  }), [feed?.posts, gameFilter, search]);

  function patchPost(updated: Post) {
    setFeed((current) => current ? { ...current, posts: current.posts.map((post) => post.id === updated.id ? updated : post) } : current);
    setPreview(isPreviewAdapterActive());
  }
  async function toggleReaction(post: Post, reaction: Reaction) {
    if (!user) { setAuthMode('login'); setModal('auth'); return; }
    setBusyPost(post.id);
    try { patchPost(await api.react(post.id, reaction)); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save your reaction.'); }
    finally { setBusyPost(null); }
  }
  async function submitComment(event: FormEvent<HTMLFormElement>, id: EntityId) {
    event.preventDefault();
    if (!user) { setAuthMode('login'); setModal('auth'); return; }
    const form = event.currentTarget; const input = new FormData(form).get('content')?.toString().trim();
    if (!input) return;
    setBusyPost(id);
    try {
      const comment = await api.comment(id, input);
      setFeed((current) => current ? { ...current, posts: current.posts.map((post) => post.id === id ? { ...post, comments: [...post.comments, comment] } : post) } : current);
      form.reset(); setPreview(isPreviewAdapterActive());
    } catch (error) { notify(error instanceof Error ? error.message : 'Comment could not be added.'); }
    finally { setBusyPost(null); }
  }
  async function removePost(post: Post) {
    if (!window.confirm(`Remove “${post.title}” from the highlights? This cannot be undone.`)) return;
    setBusyPost(post.id);
    try { await api.remove(post.id); setFeed((current) => current ? { ...current, posts: current.posts.filter((item) => item.id !== post.id) } : current); notify('Highlight removed.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this highlight.'); }
    finally { setBusyPost(null); }
  }
  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      const result = authMode === 'register'
        ? await api.register({ name: String(values.get('name') ?? '').trim(), email: String(values.get('email')), password: String(values.get('password')) })
        : await api.login({ email: String(values.get('email')), password: String(values.get('password')) });
      setUser(result.user); setFeed((current) => current ? { ...current, user: result.user } : current); setModal(null); setPreview(isPreviewAdapterActive());
      notify(`Welcome${authMode === 'register' ? ' to the community' : ' back'}, ${result.user.name}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not authenticate. Please try again.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await api.logout(); setUser(null); setFeed((current) => current ? { ...current, user: null } : current); setPreview(isPreviewAdapterActive()); notify('You are signed out.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not sign out.'); }
    finally { setBusy(false); }
  }
  async function submitPublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); const file = values.get('file');
    if (!(file instanceof File) || !file.size) { notify('Choose a photo or video to publish.'); return; }
    setBusy(true);
    try {
      const post = await api.publish({ title: String(values.get('title')).trim(), game: String(values.get('game')).trim(), caption: String(values.get('caption')).trim(), file });
      setFeed((current) => current ? { ...current, posts: [post, ...current.posts] } : current); setModal(null); setGameFilter('All highlights'); setPreview(isPreviewAdapterActive()); notify('Your highlight is live.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  }
  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const updated = await api.updateProfile({
        name: String(values.get('name') ?? '').trim(),
        username: String(values.get('username') ?? '').trim(),
        bio: String(values.get('bio') ?? '').trim(),
        ...(profilePhoto ? { avatar: profilePhoto } : {}),
      });
      setUser(updated);
      setFeed((current) => current ? { ...current, user: updated } : current);
      setProfilePhoto(undefined);
      setModal(null);
      setPreview(isPreviewAdapterActive());
      notify('Profile updated.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update your profile.'); }
    finally { setBusy(false); }
  }
  function toggleComments(id: EntityId) {
    setExpandedComments((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Shabs Gaming home" data-testid="link-home">
          <img className="obsidian-logo" src="https://reaperxweb.onrender.com/public/obsidian-games-logo.webp" alt="Obsidian Games logo" />
          <span className="brand-title">SHABS<span>.</span>GAMING</span>
        </a>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="#highlights">Highlights</a><a href="#about">Creator</a><a href="#community">Community</a>
        </nav>
        <div className="top-actions">
          {user ? <><button className="profile-control" onClick={() => { setProfilePhoto(undefined); setModal('profile'); }} aria-label={`Edit profile for ${user.name}`} data-testid="button-profile"><span className="profile-control-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</span><span className="profile-control-name">{user.name}<small>{user.username ? `@${user.username}` : 'Set your username'}</small></span><UserRound size={15} /></button>{user.role === 'owner' && <button className="button primary" onClick={() => setModal('publish')} data-testid="button-publish"><Upload size={15} /> Publish</button>}<button className="button" onClick={() => void logout()} disabled={busy} data-testid="button-logout">Sign out</button></> :
            <><button className="button" onClick={() => { setAuthMode('login'); setModal('auth'); }} data-testid="button-login"><LogIn size={15} /> Log in</button><button className="button primary" onClick={() => { setAuthMode('register'); setModal('auth'); }} data-testid="button-join">Join community</button></>}
        </div>
      </header>

      <main className="main-grid">
        <section className="feed-column" aria-label="Gaming highlights">
          <section className="hero">
            <div className="hero-visual" style={{ backgroundImage: `url("${shabsPortrait}")` }} />
            <div className="hero-copy">
              <div className="eyebrow"><span className="live-dot" /> THE SHABS COMMUNITY</div>
              <h1>Play sharp.<br /><span>Stay legendary.</span></h1>
              <p>Competitive moments, clutch rounds, and the community behind every call. Welcome to Shabs Gaming.</p>
              <div className="hero-actions">
                <a className="button primary" href="#highlights"><Swords size={15} /> Watch highlights</a>
                {!user && <button className="button" onClick={() => { setAuthMode('register'); setModal('auth'); }} data-testid="button-join-hero">Become a member <ChevronDown size={14} /></button>}
              </div>
            </div>
            <div className="hero-tag">SF ALPHA · COMMUNITY FEED</div>
          </section>

          <section className="stat-strip" aria-label="Community statistics">
            <div className="stat-box"><span className="stat-icon"><Activity size={17} /></span><div><strong>{feed?.stats.views.toLocaleString() ?? '—'}</strong><span>Highlight views</span></div></div>
            <div className="stat-box"><span className="stat-icon"><Video size={17} /></span><div><strong>{feed?.stats.highlights ?? '—'}</strong><span>Live highlights</span></div></div>
            <div className="stat-box"><span className="stat-icon"><Users size={17} /></span><div><strong>{feed?.stats.community.toLocaleString() ?? '—'}</strong><span>Players here</span></div></div>
          </section>

          <section id="highlights">
            <div className="feed-head"><div><h2>Latest highlights</h2><p>Community moments, straight from the match.</p></div>
              {user?.role === 'owner' && <button className="button primary small" onClick={() => setModal('publish')} data-testid="button-create-highlight"><ImagePlus size={14} /> New highlight</button>}
            </div>
            <div className="filter-row">
              <div className="filters" role="group" aria-label="Filter highlights by game">{allGames.map((game) => <button key={game} className={`filter-chip${game === gameFilter ? ' active' : ''}`} onClick={() => setGameFilter(game)} aria-pressed={game === gameFilter} data-testid={`filter-${game.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{game}</button>)}</div>
              <label className="search-wrap"><Search size={15} /><input type="search" placeholder="Search highlights" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search highlights" data-testid="input-search" /></label>
            </div>
            {preview && <div className="demo-note" role="status">Local preview mode — your activity is saved in this browser only. Production always uses the Shabs Gaming service.</div>}
            {loading ? <div className="post-list" aria-label="Loading highlights"><div className="skeleton" /><div className="skeleton" /></div> :
              loadError ? <div className="error-state" role="alert"><CircleAlert size={28} /><h3>Highlights unavailable</h3><p>{loadError}</p><button className="button primary" onClick={() => void loadFeed()} data-testid="button-retry">Try again</button></div> :
                visiblePosts.length ? <div className="post-list">{visiblePosts.map((post, index) => <article className="post-card" style={{ animationDelay: `${Math.min(index * 65, 300)}ms` }} key={post.id} data-testid={`card-post-${post.id}`}>
                  <div className="post-head">
                    <div className="author-line"><img className="avatar" src={post.author.avatarUrl || shabsPortrait} alt="" /><div className="author-meta"><strong>{post.author.name}</strong><span>{post.author.username ? `@${post.author.username} · ` : ''}{post.author.role} · {when(post.createdAt)}</span></div></div>
                    {user?.role === 'owner' && <button className="button quiet small danger" onClick={() => void removePost(post)} disabled={busyPost === post.id} aria-label={`Delete ${post.title}`} data-testid={`button-delete-${post.id}`}><X size={15} /> Remove</button>}
                  </div>
                  <div className="post-title">{post.title}</div>
                  {post.caption && <div className="post-caption">{post.caption}</div>}
                  <div className="media-frame">{post.type === 'video' ? <video src={post.mediaUrl} controls preload="metadata" aria-label={post.title} /> : <img src={post.mediaUrl} alt={`${post.title} by ${post.author.name}`} loading={index > 0 ? 'lazy' : 'eager'} />}<span className="game-pill">{post.game}</span></div>
                  <div className="post-foot">
                    <div className="reaction-row">
                      {([['heart', Heart, 'Heart'], ['fire', Flame, 'Fire'], ['gg', ThumbsUp, 'GG']] as const).map(([reaction, Icon, label]) =>
                        <button key={reaction} className={`reaction-btn ${reaction}${post.myReaction === reaction ? ' selected' : ''}`} onClick={() => void toggleReaction(post, reaction)} disabled={busyPost === post.id} aria-label={`${label}, ${post.reactionCounts[reaction]}`} aria-pressed={post.myReaction === reaction} data-testid={`button-${reaction}-${post.id}`}><Icon size={14} /><span>{post.reactionCounts[reaction]}</span></button>)}
                      <button className="comment-toggle" onClick={() => toggleComments(post.id)} aria-expanded={expandedComments.includes(post.id)} data-testid={`button-comments-${post.id}`}><MessageCircle size={15} /> {post.comments.length} comments</button>
                    </div>
                    {expandedComments.includes(post.id) && <div className="comment-panel">
                      <div className="comments-list">{post.comments.length ? post.comments.map((comment) => <div className="comment-item" key={comment.id} data-testid={`comment-${comment.id}`}><strong>{comment.author}</strong>{comment.content}</div>) : <div className="comment-item">No comments yet. Start the conversation.</div>}</div>
                       {user ? <form className="comment-form" onSubmit={(event) => void submitComment(event, post.id)}><input name="content" aria-label="Write a comment" placeholder="Add your take…" maxLength={500} required data-testid={`input-comment-${post.id}`} /><button className="button primary small" type="submit" disabled={busyPost === post.id} data-testid={`button-comment-submit-${post.id}`}>Send</button></form> : <button className="button small" onClick={() => { setAuthMode('login'); setModal('auth'); }} data-testid={`button-login-to-comment-${post.id}`}>Log in to comment</button>}
                    </div>}
                  </div>
                </article>)}</div> :
                  <div className="empty-state"><Search size={27} /><h3>No highlights found</h3><p>{search ? 'Try a different search or clear your filters.' : 'There are no highlights in this filter yet.'}</p><button className="button" onClick={() => { setSearch(''); setGameFilter('All highlights'); }} data-testid="button-clear-filters">Clear filters</button></div>}
          </section>
        </section>

        <aside className="side-column">
          <section className="side-card creator-card" id="about">
            <img className="creator-photo" src={user?.role === 'owner' && user.avatarUrl ? user.avatarUrl : shabsPortrait} alt="Shabs, Special Force Alpha moderator and creator" />
            <div className="creator-info"><div className="status-label">Creator profile</div><div className="creator-name">{user?.role === 'owner' ? user.name : 'Shabs'}</div>{user?.role === 'owner' && user.username && <div className="creator-handle">@{user.username}</div>}<div className="creator-role">Special Force Alpha · Moderator / Social Manager</div><p className="creator-bio">{user?.role === 'owner' && user.bio ? user.bio : 'Competitive player, community moderator, and the person behind the highlights. Here for the plays and the people.'}</p></div>
          </section>
          <section className="side-card" id="community"><h3 className="side-title">The loadout</h3><div className="topic-list"><span className="topic">Special Force Alpha</span><span className="topic">Clutch plays</span><span className="topic">Squad tactics</span><span className="topic">Community</span></div></section>
          <section className="side-card"><h3 className="side-title">Built for the squad</h3><p className="community-note"><b>Watch.</b> Catch the best rounds. <b>React.</b> Let the play speak. <b>Connect.</b> Talk it through with the community.</p>
            {!user && <button className="button primary small" style={{ marginTop: 15 }} onClick={() => { setAuthMode('register'); setModal('auth'); }} data-testid="button-join-sidebar">Join the community</button>}
            {user && <div className="demo-note">Signed in as {user.name}. Publishing is reserved for the creator.</div>}
          </section>
          <div className="status-label" style={{ justifyContent: 'center', padding: 5 }}>Shabs Gaming · Competitive community</div>
        </aside>
      </main>

      {modal === 'auth' && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="dialog-head"><div><h2 id="auth-title">{authMode === 'register' ? 'Join the squad' : 'Welcome back'}</h2><p>{authMode === 'register' ? 'Make room for one more in the community.' : 'Sign in to pick up where you left off.'}</p></div><button className="icon-button" onClick={() => setModal(null)} aria-label="Close dialog" data-testid="button-close-auth"><X size={17} /></button></div>
        <form className="form-stack" onSubmit={(event) => void submitAuth(event)}>
          {authMode === 'register' && <div className="field"><label htmlFor="auth-name">Display name</label><input id="auth-name" name="name" autoComplete="name" placeholder="How the squad knows you" required minLength={2} maxLength={48} data-testid="input-auth-name" /></div>}
          <div className="field"><label htmlFor="auth-email">Email address</label><input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required data-testid="input-auth-email" /></div>
          <div className="field"><label htmlFor="auth-password">Password</label><input id="auth-password" name="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} placeholder="At least 10 characters" required minLength={authMode === 'register' ? 10 : 1} maxLength={128} data-testid="input-auth-password" /></div>
          <button className="button primary" type="submit" disabled={busy} data-testid="button-auth-submit">{busy ? 'One moment…' : authMode === 'register' ? 'Create account' : 'Log in'}</button>
        </form>
        <p className="auth-switch">{authMode === 'register' ? 'Already part of the squad?' : 'New around here?'} <button className="text-button" onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')} data-testid="button-switch-auth">{authMode === 'register' ? 'Log in' : 'Create an account'}</button></p>
      </section></div>}

      {modal === 'profile' && user && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="dialog-head"><div><div className="dialog-kicker">MEMBER SETTINGS</div><h2 id="profile-title">Your profile</h2><p>Set how the squad sees you.</p></div><button className="icon-button" onClick={() => setModal(null)} aria-label="Close profile editor" data-testid="button-close-profile"><X size={17} /></button></div>
        <form className="form-stack" onSubmit={(event) => void submitProfile(event)}>
          <div className="profile-photo-field"><span className="profile-large-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt={`${user.name} profile`} /> : initials(user.name)}</span><label className="photo-picker" htmlFor="profile-photo"><Camera size={15} /> Change photo</label><input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProfilePhoto(event.currentTarget.files?.[0])} data-testid="input-profile-photo" /><span className="photo-hint">{profilePhoto ? `${profilePhoto.name} selected` : 'JPG, PNG, or WebP · up to 5 MB.'}</span></div>
          <div className="field"><label htmlFor="profile-name">Display name</label><input id="profile-name" name="name" defaultValue={user.name} required minLength={2} maxLength={48} autoComplete="name" data-testid="input-profile-name" /></div>
          <div className="field"><label htmlFor="profile-username">Username</label><div className="username-input"><span>@</span><input id="profile-username" name="username" defaultValue={user.username} minLength={3} maxLength={24} autoComplete="username" placeholder="yourhandle" required data-testid="input-profile-username" /></div></div>
          <div className="field"><label htmlFor="profile-bio">Bio</label><textarea id="profile-bio" name="bio" defaultValue={user.bio} maxLength={160} placeholder="What do you bring to the squad?" data-testid="input-profile-bio" /></div>
          <button className="button primary" type="submit" disabled={busy} data-testid="button-profile-save">{busy ? 'Saving profile…' : 'Save profile'}</button>
        </form>
      </section></div>}

      {modal === 'publish' && user?.role === 'owner' && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <div className="dialog-head"><div><h2 id="publish-title">Publish a highlight</h2><p>Share a photo or video with the community.</p></div><button className="icon-button" onClick={() => setModal(null)} aria-label="Close dialog" data-testid="button-close-publish"><X size={17} /></button></div>
        <form className="form-stack" onSubmit={(event) => void submitPublish(event)}>
          <div className="field"><label htmlFor="publish-title-input">Highlight title</label><input id="publish-title-input" name="title" required maxLength={120} placeholder="Give the moment a name" data-testid="input-post-title" /></div>
          <div className="field"><label htmlFor="publish-game">Game or category</label><input id="publish-game" name="game" required maxLength={60} defaultValue="Special Force Alpha" placeholder="Special Force Alpha" data-testid="input-post-game" /></div>
          <div className="field"><label htmlFor="publish-caption">Caption</label><textarea id="publish-caption" name="caption" maxLength={1000} placeholder="What happened in this round?" data-testid="input-post-caption" /></div>
          <div className="file-drop"><Upload size={21} /><span>Choose a photo or video from your device</span><input name="file" type="file" accept="image/*,video/*" required aria-label="Choose photo or video" data-testid="input-post-file" /></div>
          <button className="button primary" type="submit" disabled={busy} data-testid="button-publish-submit">{busy ? 'Uploading…' : 'Publish highlight'}</button>
        </form>
      </section></div>}
      {toast && <div className="toast-msg" role="status" data-testid="status-toast">{toast}</div>}
    </div>
  );
}

export default function AppRoot() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><ErrorBoundary><App /></ErrorBoundary><Toaster /></TooltipProvider></QueryClientProvider>;
}
