# Static frontend runtime; application dependencies remain in the build stage.
ARG NODE_BUILD_IMAGE=node:20.18.1-alpine
FROM nginx:1.30.5-alpine3.24@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS module-builder
RUN apk add --no-cache build-base openssl-dev pcre2-dev zlib-dev linux-headers curl git
RUN curl -fsSL https://nginx.org/download/nginx-1.30.5.tar.gz -o /tmp/nginx.tar.gz \
    && echo '6c20565aa2325cb82216ae804f4a4ff1875179014759a381c42ddc8e11c4906d  /tmp/nginx.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/nginx.tar.gz -C /tmp
RUN git init /tmp/ngx_brotli \
    && git -C /tmp/ngx_brotli remote add origin https://github.com/google/ngx_brotli.git \
    && git -C /tmp/ngx_brotli fetch --depth=1 origin a71f9312c2deb28875acc7bacfdd5695a111aa53 \
    && git -C /tmp/ngx_brotli checkout --detach FETCH_HEAD \
    && test "$(git -C /tmp/ngx_brotli rev-parse HEAD)" = a71f9312c2deb28875acc7bacfdd5695a111aa53
COPY deploy/static-nginx/nginx-brotli-static-range.patch /tmp/brotli-range.patch
# Match nginx gzip_static: let the standard range filter handle .br files too.
RUN git -C /tmp/ngx_brotli apply --check /tmp/brotli-range.patch \
    && git -C /tmp/ngx_brotli apply /tmp/brotli-range.patch
WORKDIR /tmp/nginx-1.30.5
RUN ./configure --with-compat --with-http_ssl_module --with-http_gzip_static_module --add-dynamic-module=/tmp/ngx_brotli/static && make modules

FROM ${NODE_BUILD_IMAGE} AS app-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
# Preserve the existing public inputs, build mode and service-worker identity.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA
ARG VITE_MP_PUBLIC_KEY
ENV VITE_MP_PUBLIC_KEY=$VITE_MP_PUBLIC_KEY
RUN test -n "$VITE_API_URL" && test -n "$RAILWAY_GIT_COMMIT_SHA" && test -n "$VITE_MP_PUBLIC_KEY" \
    && NODE_ENV=production npm run build \
    && node --input-type=module -e 'import {precompress} from "./scripts/prepare-static-runtime.mjs"; console.log(JSON.stringify(await precompress("dist")))'

FROM nginx:1.30.5-alpine3.24@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
ENV PORT=3000
ENV NGINX_ENVSUBST_FILTER=^PORT$
COPY --from=module-builder /tmp/nginx-1.30.5/objs/ngx_http_brotli_static_module.so /usr/lib/nginx/modules/
COPY deploy/static-nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/static-nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/static-nginx/start-static-nginx.sh /usr/local/bin/start-static-nginx
# The shared legacy Railway config may override CMD with `sh start.sh`.
# This image-local entry point must never invoke the repository's API launcher.
WORKDIR /srv/frontend
COPY deploy/static-nginx/start-legacy-static-nginx.sh /srv/frontend/start.sh
RUN chmod 755 /usr/local/bin/start-static-nginx /srv/frontend/start.sh
COPY --from=app-builder /app/dist /srv/frontend/public
EXPOSE 3000
ENTRYPOINT []
CMD ["/usr/local/bin/start-static-nginx"]
