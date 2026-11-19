import { defaultMyText, ApiError, type MyText, type ApiClient, type ApiRoutes, type Channel, type Post, type Product, type Settings, type TodayStats, type User } from './index';

export const fakeAccounts: Record<string, User> = {
  manager: { userNo: 12, name: '김매니저', nickname: '골프매니저', phone: '', userType: 4, role: 'manager' },
  staff: { userNo: 13, name: '이직원', userType: 7, role: 'staff' },
  admin: { userNo: 14, name: '박관리자', userType: 9, role: 'admin' },
};
const titles = ['다낭 3색 골프 3박 5일', '방콕 시티호텔 2색 골프 3박 5일', '후쿠오카 온천 골프 2박 3일', '클락 무제한 골프 3박 5일', '나트랑 해변 골프 3박 5일', '치앙마이 골프 4박 6일', '오사카 골프 2박 3일', '세부 골프 3박 5일', '하노이 골프 3박 5일', '파타야 골프 3박 5일', '미야자키 골프 2박 3일', '마닐라 골프 3박 5일', '달랏 고원 골프 3박 5일', '푸껫 골프 3박 5일', '오키나와 골프 3박 4일', '보홀 골프 3박 5일'];
const regions = ['다낭', '방콕', '후쿠오카', '클락', '나트랑', '치앙마이', '오사카', '세부', '하노이', '파타야', '미야자키', '마닐라', '달랏', '푸껫', '오키나와', '보홀'];
const counts = [6, 4, 3, 5];
const prices = [1190000, 990000, 1350000, 890000];
const stamp = '2026-11-12T09:00:00+09:00';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function createFakeApi(fixtureSession?: { token: string; user: User; productTitle?: string }): ApiClient {
  let settings: Settings = { closingText: '', defaultHashtags: [], bandDailyLimit: 3 };
  const personalText = new Map<number, MyText>();
  const sessions = new Map<string, User>();
  if (fixtureSession) sessions.set(fixtureSession.token, copy(fixtureSession.user));
  let serial = 100;
  const products: Product[] = titles.map((title, i) => ({
    productNo: 1234 + i, title: i === 0 ? fixtureSession?.productTitle ?? `[골투오토 실험] WP5 ${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)} 다낭 예시` : title, country: ['베트남', '태국', '일본', '필리핀'][i % 4]!, region: regions[i]!,
    contentsHtml: i === 0 ? Array.from({ length: 5 }, (_, n) => `<p>예시 일정 ${n + 1} 안내입니다. 골프장과 숙소를 확인합니다.</p><img src="https://example.invalid/images/0/${n}.png">`).join('') + '<p>출발일과 가격은 아래 표에서 확인하세요.</p>' : `<p>${regions[i]}의 골프장을 도는 일정입니다. 항공과 호텔, 그린피가 포함됩니다.</p>`,
    images: Array.from({ length: 5 }, (_, order) => ({ order: order + 1, url: `https://example.invalid/images/${i}/${order}.png` })),
    departures: Array.from({ length: counts[i % 4]! }, (_, d) => ({ date: `${i >= 12 ? '2027-01' : '2026-12'}-${String(3 + d * 4 + (d ? 3 : 0)).padStart(2, '0')}`, price: prices[i % 4]! + d * 60000 })),
    golfCourses: i === 0 ? ['다낭CC', '몽고메리CC', '바나힐CC'] : [`${regions[i]}CC`],
    productUrl: `https://example.invalid/products/${1234 + i}`, updatedAt: stamp, ownerNickname: i % 2 ? null : '골프매니저', contentHash: `fake-content-${i}`,
  }));
  type StoredPost = Post & { owner: number; targetKey: string; hash: string };
  const posts: StoredPost[] = [];
  const traces = new Map<string, ApiRoutes['/auto/posts/trace']['input']>();
  const seed = (product: number, channel: Channel, status: Post['status'], owner = 12, changed = false) => {
    const p = products[product]!;
    const at = `2026-11-${product === 0 ? '12' : product === 1 ? '10' : product === 2 ? '08' : '07'}T09:00:00+09:00`;
    posts.push({ postNo: serial++, productNo: p.productNo, productTitle: p.title, channel, mode: status === 'published' ? 'publish' : 'draft', targetName: channel === 'blog' ? '해외골프' : '골투 여행', status, step: status === 'failed' ? 6 : 7, failReason: status === 'failed' ? '사진 올리기 응답 없음' : '', postUrl: status === 'published' ? `https://example.invalid/posts/${serial}` : '', userName: Object.values(fakeAccounts).find(u => u.userNo === owner)!.name, startedAt: at, finishedAt: at, productChanged: changed, owner, targetKey: 'travel', hash: changed ? 'old-hash' : p.contentHash });
  };
  seed(0, 'blog', 'draft_saved'); seed(0, 'band', 'stopped_before_post'); seed(1, 'blog', 'published'); seed(1, 'band', 'failed'); seed(2, 'blog', 'published', 12, true); seed(2, 'band', 'published', 12, true); seed(4, 'blog', 'published', 13);
  return { async request<P extends keyof ApiRoutes>(path: P, input: ApiRoutes[P]['input'], token?: string): Promise<ApiRoutes[P]['output']> {
    const data = input as unknown as Record<string, unknown>;
    let output: unknown;
    if (path === '/auto/login') {
      if (data.loginId === 'member' || /^[012]$/.test(String(data.loginId))) throw new ApiError('forbidden', '골투오토는 골투 매니저와 직원만 쓸 수 있습니다.');
      const user = fakeAccounts[String(data.loginId)];
      if (!user || data.password !== 'demo') throw new ApiError('auth', '예시 계정과 비밀번호를 확인해 주세요.');
      const session = `demo-session-${++serial}`; sessions.set(session, user); output = { token: session, user };
    } else {
      const user = sessions.get(token ?? '');
      if (!user) throw new ApiError('auth', '다시 로그인해 주세요.');
      const page = <T>(items: T[]) => { const size = Math.min(50, Math.max(1, Number(data.pageSize) || 20)); const offset = (Math.max(1, Number(data.page) || 1) - 1) * size; return { total: items.length, items: items.slice(offset, offset + size) }; };
      const successful = (p: StoredPost) => p.status === 'draft_saved' || p.status === 'published';
      const visibleMark = (p: StoredPost) => successful(p) || p.channel === 'band' && p.status === 'stopped_before_post';
      switch (path) {
        case '/auto/logout': sessions.delete(token!); output = {}; break;
        case '/auto/me': output = { user, settings, myText: personalText.get(user.userNo) ?? defaultMyText() }; break;
        case '/auto/me/text/save': {
          const value = input as MyText;
          if (typeof value.prefix !== 'string' || [...value.prefix].length > 500 || typeof value.closing !== 'string' || [...value.closing].length > 1000 || typeof value.closingOn !== 'boolean') throw new ApiError('invalid', '글 앞·끝 문구를 확인해 주세요.');
          personalText.set(user.userNo, copy(value)); output = {}; break;
        }
        case '/auto/products/get': {
          const product = products.find(p => p.productNo === data.productNo);
          if (!product) throw new ApiError('not_found', '상품을 찾지 못했습니다.');
          output = { ...product, posts: posts.filter(p => p.productNo === product.productNo && successful(p))
            .sort((a, b) => (b.finishedAt || b.startedAt).localeCompare(a.finishedAt || a.startedAt) || b.postNo - a.postNo).slice(0, 30)
            .map(p => ({ postNo: p.postNo, channel: p.channel, mode: p.mode, status: p.status, nickname: Object.values(fakeAccounts).find(u => u.userNo === p.owner)?.nickname ?? p.userName,
              at: p.finishedAt || p.startedAt, targetName: p.targetName, targetKey: p.channel === 'band' ? p.targetKey : '', postUrl: p.postUrl, changed: p.hash !== product.contentHash })) }; break;
        }
        case '/auto/products/list': {
          let filtered = products.filter(p => (!data.q || `${p.title} ${p.country} ${p.region} ${p.golfCourses.join(' ')}`.includes(String(data.q))) && (!data.country || p.country === data.country) && (!data.region || p.region === data.region) && (!data.month || p.departures.some(d => d.date.startsWith(String(data.month)))) && (!data.onlyUnposted || !posts.some(post => post.owner === user.userNo && post.productNo === p.productNo && successful(post))));
          if (data.sort === 'departure') filtered = [...filtered].sort((a, b) => a.departures[0]!.date.localeCompare(b.departures[0]!.date));
          output = page(filtered.map(p => {
            const latest = (channel: Channel) => [...posts].reverse().find(post => post.owner === user.userNo && post.productNo === p.productNo && post.channel === channel && visibleMark(post));
            const mark = (channel: Channel) => { const post = latest(channel); return post ? { status: post.status, at: post.finishedAt.slice(0, 10) } : null; };
            const changed = (channel: Channel) => { const post = latest(channel); return !!post && post.hash !== p.contentHash; };
            return { productNo: p.productNo, title: p.title, country: p.country, region: p.region, thumbUrl: p.images[0]!.url, priceFrom: Math.min(...p.departures.map(d => d.price)), departureCount: p.departures.length, updatedAt: p.updatedAt, ownerNickname: p.ownerNickname, changed: { blog: changed('blog'), band: changed('band') }, myPosts: { blog: mark('blog'), band: mark('band') } };
          })); break;
        }
        case '/auto/posts/list':
          if (data.scope === 'all' && user.userType < 7) throw new ApiError('forbidden', '전체 기록은 내부직원과 관리자만 볼 수 있습니다.');
          output = page([...posts].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.postNo - a.postNo).filter(p => data.scope === 'all' || p.owner === user.userNo).map(({ owner, targetKey, hash, ...post }) => ({ ...post, productChanged: hash !== products.find(p => p.productNo === post.productNo)?.contentHash }))); break;
        case '/auto/stats/today': {
          if (user.role !== 'admin') throw new ApiError('forbidden', '관리자만 오늘 현황을 볼 수 있습니다.');
          const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
          const rows = new Map<number, TodayStats['rows'][number]>();
          for (const post of posts) {
            if (new Date(post.startedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) !== date) continue;
            const owner = Object.values(fakeAccounts).find(account => account.userNo === post.owner);
            const row = rows.get(post.owner) ?? { userNo: post.owner, nickname: owner?.nickname || post.userName, published: 0, drafts: 0, failed: 0, stopped: 0, lastAt: '' };
            if (post.status === 'published') row.published++;
            if (post.status === 'draft_saved') row.drafts++;
            if (post.status === 'failed') row.failed++;
            if (post.status === 'stopped') row.stopped++;
            if (Date.parse(post.startedAt) > Date.parse(row.lastAt) || !row.lastAt) row.lastAt = post.startedAt;
            rows.set(post.owner, row);
          }
          output = { date, rows: [...rows.values()] }; break;
        }
        case '/auto/posts/start': {
          const value = input as ApiRoutes['/auto/posts/start']['input'];
          const product = products.find(p => p.productNo === value.productNo);
          if (!product) throw new ApiError('not_found', '상품을 찾지 못했습니다.');
          const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
          if (value.channel === 'band' && posts.filter(p => p.owner === user.userNo && p.channel === 'band' && p.startedAt.slice(0, 10) === today && p.status !== 'failed' && p.status !== 'stopped').length >= settings.bandDailyLimit) throw new ApiError('conflict', '밴드 하루 등록 한도에 도달했습니다.');
          const postNo = ++serial;
          posts.push({ postNo, productNo: product.productNo, productTitle: product.title, channel: value.channel, mode: value.mode, targetName: value.target.name, status: 'running', step: 1, failReason: '', postUrl: '', userName: user.name, startedAt: `${today}T12:00:00+09:00`, finishedAt: '', productChanged: false, owner: user.userNo, targetKey: value.target.key, hash: value.contentHash });
          output = { postNo }; break;
        }
        case '/auto/posts/log': {
          const post = posts.find(p => p.postNo === data.postNo);
          if (!post) throw new ApiError('not_found', '기록을 찾지 못했습니다.');
          if (post.owner !== user.userNo && user.role !== 'admin') throw new ApiError('forbidden', '내 기록만 고칠 수 있습니다.');
          if (typeof data.log !== 'string' || data.log.length > 524288) throw new ApiError('invalid', '로그 길이를 확인해 주세요.');
          output = {}; break;
        }
        case '/auto/posts/trace': {
          const value = input as ApiRoutes['/auto/posts/trace']['input'];
          const utc = (stamp: unknown) => typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(stamp) && Number.isFinite(Date.parse(stamp));
          const fits = (text: unknown, limit: number) => typeof text === 'string' && text.length <= limit;
          const bytes = (text: string) => new TextEncoder().encode(text).length;
          if (!Number.isSafeInteger(value.postNo) || value.postNo < 1 || typeof value.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.jobId) ||
            !['blog_draft', 'blog_publish', 'blog_delete', 'band_post', 'band_delete', 'record'].includes(value.kind) ||
            !['blog', 'band'].includes(value.channel) || !['partial', 'final'].includes(value.phase) ||
            !fits(value.appVersion, 20) || !fits(value.device, 60) || !utc(value.startedAt) ||
            !(value.endedAt === null || utc(value.endedAt)) ||
            !['running', 'success', 'failed', 'stopped', 'paused', 'incomplete'].includes(value.result) ||
            !fits(value.reason, 120) || !value.summary || typeof value.summary !== 'object' || Array.isArray(value.summary) ||
            bytes(JSON.stringify(value.summary)) > 65536 || typeof value.log !== 'string' || bytes(value.log) > 524288 ||
            typeof value.truncated !== 'boolean' || !Number.isSafeInteger(value.droppedLines) || value.droppedLines < 0) {
            throw new ApiError('invalid', '추적 로그 입력을 확인해 주세요.');
          }
          const post = posts.find(p => p.postNo === value.postNo);
          if (!post || post.channel !== value.channel) throw new ApiError('invalid', '기록을 찾지 못했습니다.');
          if (post.owner !== user.userNo && user.role !== 'admin') throw new ApiError('forbidden', '내 기록만 고칠 수 있습니다.');
          const previous = traces.get(value.jobId);
          if (previous && previous.postNo !== value.postNo) throw new ApiError('conflict', '작업 번호가 이미 등록됐습니다.');
          traces.set(value.jobId, copy(value));
          output = {}; break;
        }
        case '/auto/posts/update': {
          const value = input as ApiRoutes['/auto/posts/update']['input']; const post = posts.find(p => p.postNo === value.postNo);
          if (!post) throw new ApiError('not_found', '기록을 찾지 못했습니다.');
          if (post.owner !== user.userNo) throw new ApiError('forbidden', '내 기록만 고칠 수 있습니다.');
          if (value.status === 'stopped_before_post' && post.channel !== 'band') throw new ApiError('invalid', '밴드만 게시 전 멈춤으로 기록할 수 있습니다.');
          if (post.status === 'stopped_before_post' && !['published', 'stopped', 'stopped_before_post'].includes(value.status)) throw new ApiError('conflict', '게시 전 멈춤 기록은 게시 완료 또는 중단으로만 바꿀 수 있습니다.');
          if (successful(post) && value.status === 'running') throw new ApiError('conflict', '저장한 기록을 다시 실행할 수 없습니다.');
          Object.assign(post, value, { finishedAt: value.status === 'running' ? '' : new Date().toISOString() }); output = {}; break;
        }
        case '/auto/settings/save': {
          if (user.userType < 8) throw new ApiError('forbidden', '관리자만 설정을 저장할 수 있습니다.');
          const value = input as Settings;
          if (!Number.isInteger(value.bandDailyLimit) || value.bandDailyLimit < 1 || value.bandDailyLimit > 100) throw new ApiError('invalid', '밴드 하루 한도는 1~100으로 입력해 주세요.');
          settings = copy(value); output = {}; break;
        }
        case '/auto/app/latest': output = { ready: false }; break;
        default: throw new ApiError('not_found', '지원하지 않는 요청입니다.');
      }
    }
    return copy(output) as ApiRoutes[P]['output'];
  } };
}
