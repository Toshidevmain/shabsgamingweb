FROM node:22-alpine AS web-build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN PORT=5173 BASE_PATH=/ pnpm --filter @workspace/shabs-gaming run build

FROM composer:2 AS php-dependencies
WORKDIR /app
COPY artifacts/shabs-gaming/backend/composer.json ./composer.json
RUN composer install --no-dev --prefer-dist --no-interaction --classmap-authoritative \
    --ignore-platform-req=ext-mongodb

FROM php:8.3-apache
RUN apt-get update \
    && apt-get install -y --no-install-recommends $PHPIZE_DEPS libssl-dev \
    && pecl install mongodb \
    && docker-php-ext-enable mongodb \
    && apt-get purge -y --auto-remove $PHPIZE_DEPS libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN a2enmod rewrite headers
WORKDIR /var/www/html
COPY artifacts/shabs-gaming/backend/public/ ./public/
COPY --from=php-dependencies /app/vendor/ ./vendor/
COPY --from=web-build /workspace/artifacts/shabs-gaming/dist/public/index.html ./public/app.html
COPY --from=web-build /workspace/artifacts/shabs-gaming/dist/public/assets/ ./public/assets/
COPY artifacts/shabs-gaming/backend/docker-entrypoint.sh /usr/local/bin/shabs-entrypoint
RUN chmod +x /usr/local/bin/shabs-entrypoint

ENV APP_ENV=production
ENV PORT=10000
ENV PHP_UPLOAD_MAX_FILESIZE=100M
ENV PHP_POST_MAX_SIZE=105M
EXPOSE 10000
ENTRYPOINT ["/usr/local/bin/shabs-entrypoint"]
