export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    let res = await env.ASSETS.fetch(request)

    // SPA fallback: 404 时回退到 index.html
    if (res.status === 404 && !url.pathname.startsWith('/api/')) {
      const indexUrl = new URL('/index.html', url)
      res = await env.ASSETS.fetch(new Request(indexUrl, request))
    }

    // 安全与缓存优化（基础）
    const headers = new Headers(res.headers)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'no-referrer')
    // 可按需添加缓存策略：静态资源较长缓存，HTML 短缓存
    if (/\.(css|js|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(url.pathname)) {
      headers.set('Cache-Control', 'public, max-age=604800, immutable')
    } else {
      headers.set('Cache-Control', 'no-cache')
    }

    return new Response(res.body, { status: res.status, headers })
  }
}