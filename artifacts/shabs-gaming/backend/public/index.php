<?php
declare(strict_types=1);

use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Client;
use MongoDB\GridFS\Bucket;

require dirname(__DIR__) . '/vendor/autoload.php';

ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Strict');
session_name('shabs_session');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => isSecureRequest(),
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: DENY');

function isSecureRequest(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || getenv('APP_ENV') === 'production';
}

function respond(array $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function requestJson(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 32768) {
        respond(['error' => 'Request body is too large.'], 413);
    }
    if ($raw === '') {
        return [];
    }
    try {
        $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        respond(['error' => 'Invalid JSON request.'], 400);
    }
    if (!is_array($data)) {
        respond(['error' => 'Expected a JSON object.'], 400);
    }
    return $data;
}

function assertSameOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $requestHost = $_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '';
    $originHost = parse_url($origin, PHP_URL_HOST);
    $requestHost = parse_url('http://' . $requestHost, PHP_URL_HOST);
    if (!$originHost || !$requestHost || strcasecmp((string) $originHost, (string) $requestHost) !== 0) {
        respond(['error' => 'Request origin could not be verified.'], 403);
    }
}

function mongoDatabase(): MongoDB\Database
{
    static $database = null;
    if ($database !== null) {
        return $database;
    }

    $uri = getenv('MONGODB_URI');
    if (!$uri) {
        respond(['error' => 'The database is not configured. Set MONGODB_URI on the server.'], 503);
    }

    $path = trim((string) parse_url($uri, PHP_URL_PATH), '/');
    $databaseName = getenv('MONGODB_DATABASE') ?: $path;
    if ($databaseName === '') {
        respond(['error' => 'Set MONGODB_DATABASE because the connection string has no database name.'], 503);
    }

    $client = new Client($uri, ['serverSelectionTimeoutMS' => 8000]);
    $database = $client->selectDatabase($databaseName, [
        'typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array'],
    ]);
    ensureIndexes($database);
    return $database;
}

function ensureIndexes(MongoDB\Database $database): void
{
    static $ready = false;
    if ($ready) {
        return;
    }
    $database->selectCollection('users')->createIndex(['email' => 1], ['unique' => true]);
    $database->selectCollection('users')->createIndex(['username' => 1], ['unique' => true, 'sparse' => true]);
    $database->selectCollection('comments')->createIndex(['postId' => 1, 'createdAt' => -1]);
    $database->selectCollection('reactions')->createIndex(
        ['postId' => 1, 'userId' => 1],
        ['unique' => true],
    );
    $database->selectCollection('auth_limits')->createIndex(
        ['expiresAt' => 1],
        ['expireAfterSeconds' => 0],
    );
    $ready = true;
}

function gridFsBucket(): Bucket
{
    return mongoDatabase()->selectGridFSBucket();
}

function currentUser(): ?array
{
    $userId = $_SESSION['userId'] ?? null;
    if (!is_string($userId) || !preg_match('/^[a-f0-9]{24}$/i', $userId)) {
        return null;
    }
    $user = mongoDatabase()->selectCollection('users')->findOne(['_id' => new ObjectId($userId)]);
    return $user ? publicUser($user) : null;
}

function requireUser(): array
{
    $user = currentUser();
    if (!$user) {
        respond(['error' => 'Sign in to continue.'], 401);
    }
    return $user;
}

function requireOwner(): array
{
    $user = requireUser();
    if (($user['role'] ?? '') !== 'owner') {
        respond(['error' => 'Only the channel owner can publish or remove highlights.'], 403);
    }
    return $user;
}

function publicUser(array $user): array
{
    $avatarId = $user['avatarId'] ?? null;
    return [
        'id' => (string) $user['_id'],
        'name' => (string) ($user['name'] ?? 'Player'),
        'email' => (string) ($user['email'] ?? ''),
        'role' => (string) ($user['role'] ?? 'member'),
        'username' => (string) ($user['username'] ?? ''),
        'bio' => (string) ($user['bio'] ?? ''),
        'avatarUrl' => $avatarId instanceof ObjectId ? '/api/media/' . (string) $avatarId : null,
    ];
}

function startUserSession(array $user): void
{
    session_regenerate_id(true);
    $_SESSION['userId'] = (string) $user['_id'];
}

function parseObjectId(string $id): ObjectId
{
    if (!preg_match('/^[a-f0-9]{24}$/i', $id)) {
        respond(['error' => 'Highlight not found.'], 404);
    }
    return new ObjectId($id);
}

function dateString(mixed $date): string
{
    if ($date instanceof UTCDateTime) {
        return $date->toDateTime()->format(DateTimeInterface::ATOM);
    }
    return gmdate(DateTimeInterface::ATOM);
}

function commentCard(array $comment): array
{
    return [
        'id' => (string) $comment['_id'],
        'author' => (string) ($comment['authorName'] ?? 'Player'),
        'content' => (string) ($comment['content'] ?? ''),
        'createdAt' => dateString($comment['createdAt'] ?? null),
    ];
}

function postCard(array $post, ?string $viewerId): array
{
    $database = mongoDatabase();
    $postId = $post['_id'];
    $reactionCounts = ['heart' => 0, 'fire' => 0, 'gg' => 0];
    $counts = $database->selectCollection('reactions')->aggregate([
        ['$match' => ['postId' => $postId]],
        ['$group' => ['_id' => '$reaction', 'count' => ['$sum' => 1]]],
    ]);
    foreach ($counts as $count) {
        if (isset($reactionCounts[$count['_id']])) {
            $reactionCounts[$count['_id']] = (int) $count['count'];
        }
    }

    $myReaction = null;
    if ($viewerId !== null) {
        $reaction = $database->selectCollection('reactions')->findOne([
            'postId' => $postId,
            'userId' => $viewerId,
        ]);
        $myReaction = $reaction['reaction'] ?? null;
    }

    $comments = $database->selectCollection('comments')->find(
        ['postId' => $postId],
        ['sort' => ['createdAt' => -1], 'limit' => 20],
    );
    $commentsOut = array_map('commentCard', iterator_to_array($comments, false));
    $commentsOut = array_reverse($commentsOut);

    return [
        'id' => (string) $postId,
        'title' => (string) ($post['title'] ?? ''),
        'caption' => (string) ($post['caption'] ?? ''),
        'game' => (string) ($post['game'] ?? 'Gameplay'),
        'type' => (string) ($post['type'] ?? 'image'),
        'mediaUrl' => '/api/media/' . (string) $post['mediaId'],
        'createdAt' => dateString($post['createdAt'] ?? null),
        'author' => [
            'name' => (string) ($post['authorName'] ?? 'Shabs'),
            'role' => 'Special Force Alpha Moderator / Social Manager',
            'username' => (string) ($post['authorUsername'] ?? ''),
            'avatarUrl' => isset($post['authorAvatarUrl']) ? (string) $post['authorAvatarUrl'] : null,
        ],
        'reactionCounts' => $reactionCounts,
        'myReaction' => $myReaction,
        'comments' => $commentsOut,
    ];
}

function findPost(string $id): array
{
    $post = mongoDatabase()->selectCollection('posts')->findOne(['_id' => parseObjectId($id)]);
    if (!$post) {
        respond(['error' => 'Highlight not found.'], 404);
    }
    return $post;
}

function routeRequest(): void
{
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = rtrim($path, '/') ?: '/';
    if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        assertSameOrigin();
    }

    if ($method === 'GET' && $path === '/api/health') {
        mongoDatabase()->command(['ping' => 1]);
        respond(['status' => 'ok']);
    }

    if ($method === 'GET' && $path === '/api/auth/me') {
        respond(['user' => currentUser()]);
    }

    if ($method === 'POST' && $path === '/api/auth/register') {
        $input = requestJson();
        $name = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $setupCode = (string) ($input['setupCode'] ?? '');
        if (strlen($name) < 2 || strlen($name) > 48) {
            respond(['error' => 'Name must be between 2 and 48 characters.'], 422);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            respond(['error' => 'Enter a valid email address.'], 422);
        }
        if (strlen($password) < 10 || strlen($password) > 128) {
            respond(['error' => 'Password must be at least 10 characters.'], 422);
        }

        $ownerToken = getenv('ADMIN_SETUP_TOKEN') ?: '';
        $claimOwner = $setupCode !== '';
        if ($claimOwner && ($ownerToken === '' || !hash_equals($ownerToken, $setupCode))) {
            respond(['error' => 'The owner setup code is not valid.'], 403);
        }

        $users = mongoDatabase()->selectCollection('users');
        if ($users->findOne(['email' => $email], ['projection' => ['_id' => 1]])) {
            respond(['error' => 'An account with this email already exists.'], 409);
        }
        $passwordHash = password_hash(
            $password,
            defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT,
        );
        $insert = $users->insertOne([
            'name' => $name,
            'email' => $email,
            'passwordHash' => $passwordHash,
            'role' => 'member',
            'createdAt' => new UTCDateTime(),
        ]);
        $user = $users->findOne(['_id' => $insert->getInsertedId()]);

        if ($claimOwner) {
            try {
                $claim = mongoDatabase()->selectCollection('settings')->updateOne(
                    ['_id' => 'owner_claimed'],
                    ['$setOnInsert' => ['claimedAt' => new UTCDateTime()]],
                    ['upsert' => true],
                );
            } catch (Throwable) {
                $users->deleteOne(['_id' => $insert->getInsertedId()]);
                respond(['error' => 'Owner setup has already been completed.'], 409);
            }
            if ($claim->getUpsertedCount() !== 1) {
                $users->deleteOne(['_id' => $insert->getInsertedId()]);
                respond(['error' => 'Owner setup has already been completed.'], 409);
            }
            $users->updateOne(['_id' => $insert->getInsertedId()], ['$set' => ['role' => 'owner']]);
            $user['role'] = 'owner';
        }

        startUserSession($user);
        respond(['user' => publicUser($user)], 201);
    }

    if ($method === 'POST' && $path === '/api/auth/login') {
        $input = requestJson();
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '') {
            respond(['error' => 'Check your email and password.'], 422);
        }
        $database = mongoDatabase();
        $ipHash = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $limits = $database->selectCollection('auth_limits');
        $limit = $limits->findOne(['_id' => $ipHash]);
        $expiresAt = $limit['expiresAt'] ?? null;
        if ($expiresAt instanceof UTCDateTime && $expiresAt->toDateTime()->getTimestamp() > time()) {
            respond(['error' => 'Too many sign-in attempts. Try again in 15 minutes.'], 429);
        }
        if ($limit) {
            $limits->deleteOne(['_id' => $ipHash]);
        }
        $user = $database->selectCollection('users')->findOne(['email' => $email]);
        if (!$user || !password_verify($password, (string) ($user['passwordHash'] ?? ''))) {
            $limits->updateOne(
                ['_id' => $ipHash],
                ['$set' => ['expiresAt' => new UTCDateTime((time() + 900) * 1000)], '$inc' => ['failures' => 1]],
                ['upsert' => true],
            );
            respond(['error' => 'Check your email and password.'], 401);
        }
        $limits->deleteOne(['_id' => $ipHash]);
        startUserSession($user);
        respond(['user' => publicUser($user)]);
    }

    if ($method === 'POST' && $path === '/api/auth/logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => 'Strict',
            ]);
        }
        session_destroy();
        respond(['ok' => true]);
    }

    if ($method === 'POST' && $path === '/api/auth/profile') {
        $user = requireUser();
        $input = str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')
            ? requestJson()
            : $_POST;
        $name = trim((string) ($input['name'] ?? ''));
        $username = strtolower(trim((string) ($input['username'] ?? '')));
        $bio = trim((string) ($input['bio'] ?? ''));
        if (strlen($name) < 2 || strlen($name) > 48) {
            respond(['error' => 'Name must be between 2 and 48 characters.'], 422);
        }
        if (!preg_match('/^[a-z0-9_]{3,24}$/', $username)) {
            respond(['error' => 'Username must be 3–24 characters using letters, numbers, or underscores.'], 422);
        }
        if (strlen($bio) > 160) {
            respond(['error' => 'Bio must be 160 characters or fewer.'], 422);
        }

        $users = mongoDatabase()->selectCollection('users');
        $userId = new ObjectId($user['id']);
        if ($users->findOne(['username' => $username, '_id' => ['$ne' => $userId]], ['projection' => ['_id' => 1]])) {
            respond(['error' => 'That username is already taken.'], 409);
        }

        $userDocument = $users->findOne(['_id' => $userId]);
        if (!$userDocument) {
            respond(['error' => 'Account not found.'], 404);
        }
        $oldAvatarId = $userDocument['avatarId'] ?? null;
        $set = ['name' => $name, 'username' => $username, 'bio' => $bio];
        $newAvatarId = null;
        $avatarFile = $_FILES['avatar'] ?? null;
        if (is_array($avatarFile) && ($avatarFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            if (($avatarFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($avatarFile['tmp_name'])) {
                respond(['error' => 'The profile photo could not be uploaded.'], 422);
            }
            if ((int) ($avatarFile['size'] ?? 0) > 5 * 1024 * 1024) {
                respond(['error' => 'Profile photos must be 5 MB or smaller.'], 413);
            }
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($avatarFile['tmp_name']) ?: '';
            if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
                respond(['error' => 'Choose a JPG, PNG, or WebP profile photo.'], 422);
            }
            $source = fopen($avatarFile['tmp_name'], 'rb');
            if ($source === false) {
                respond(['error' => 'The profile photo could not be read.'], 400);
            }
            try {
                $newAvatarId = gridFsBucket()->uploadFromStream(
                    basename((string) ($avatarFile['name'] ?? 'profile-photo')),
                    $source,
                    ['metadata' => [
                        'contentType' => $mime,
                        'userId' => $user['id'],
                        'purpose' => 'avatar',
                    ]],
                );
            } finally {
                fclose($source);
            }
            $set['avatarId'] = $newAvatarId;
        }

        $users->updateOne(['_id' => $userId], ['$set' => $set]);
        $authorFields = ['authorName' => $name, 'authorUsername' => $username];
        if ($newAvatarId instanceof ObjectId) {
            $authorFields['authorAvatarUrl'] = '/api/media/' . (string) $newAvatarId;
        }
        mongoDatabase()->selectCollection('posts')->updateMany(
            ['authorId' => $user['id']],
            ['$set' => $authorFields],
        );
        mongoDatabase()->selectCollection('comments')->updateMany(
            ['userId' => $user['id']],
            ['$set' => ['authorName' => $name]],
        );
        if ($newAvatarId instanceof ObjectId && $oldAvatarId instanceof ObjectId && $oldAvatarId != $newAvatarId) {
            try {
                gridFsBucket()->delete($oldAvatarId);
            } catch (Throwable) {
                error_log('Shabs Gaming could not remove a replaced profile photo.');
            }
        }
        $updatedUser = $users->findOne(['_id' => $userId]);
        respond(['user' => publicUser($updatedUser)]);
    }

    if ($method === 'GET' && $path === '/api/feed') {
        $database = mongoDatabase();
        $user = currentUser();
        $viewerId = $user['id'] ?? null;
        $posts = $database->selectCollection('posts')->find([], [
            'sort' => ['createdAt' => -1],
            'limit' => 30,
        ]);
        $postCards = array_map(
            static fn(array $post): array => postCard($post, $viewerId),
            iterator_to_array($posts, false),
        );
        $views = 0;
        foreach ($postCards as $postCard) {
            $database->selectCollection('posts')->updateOne(
                ['_id' => new ObjectId($postCard['id'])],
                ['$inc' => ['views' => 1]],
            );
            $stored = $database->selectCollection('posts')->findOne(
                ['_id' => new ObjectId($postCard['id'])],
                ['projection' => ['views' => 1]],
            );
            $views += (int) ($stored['views'] ?? 0);
        }
        respond([
            'posts' => $postCards,
            'user' => $user,
            'stats' => [
                'views' => $views,
                'highlights' => $database->selectCollection('posts')->countDocuments(),
                'community' => $database->selectCollection('users')->countDocuments(),
            ],
        ]);
    }

    if ($method === 'POST' && $path === '/api/posts') {
        $owner = requireOwner();
        $title = trim((string) ($_POST['title'] ?? ''));
        $game = trim((string) ($_POST['game'] ?? 'Special Force Alpha'));
        $caption = trim((string) ($_POST['caption'] ?? ''));
        if ($title === '' || strlen($title) > 120 || strlen($game) > 64 || strlen($caption) > 1000) {
            respond(['error' => 'Add a title and keep the details within the stated limits.'], 422);
        }
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            respond(['error' => 'Choose a valid photo or video file.'], 422);
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) ?: '';
        $imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        $videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
        $isImage = in_array($mime, $imageTypes, true);
        $isVideo = in_array($mime, $videoTypes, true);
        $maxBytes = $isImage ? 15 * 1024 * 1024 : 100 * 1024 * 1024;
        if ((!$isImage && !$isVideo) || (int) $file['size'] > $maxBytes) {
            respond(['error' => 'Use a supported image up to 15 MB or video up to 100 MB.'], 413);
        }

        $source = fopen($file['tmp_name'], 'rb');
        if ($source === false) {
            respond(['error' => 'The selected file could not be read.'], 400);
        }
        $mediaId = gridFsBucket()->uploadFromStream(
            basename((string) $file['name']),
            $source,
            ['metadata' => [
                'contentType' => $mime,
                'ownerId' => $owner['id'],
                'originalName' => basename((string) $file['name']),
            ]],
        );
        fclose($source);
        $insert = mongoDatabase()->selectCollection('posts')->insertOne([
            'title' => $title,
            'game' => $game !== '' ? $game : 'Gameplay',
            'caption' => $caption,
            'type' => $isVideo ? 'video' : 'image',
            'mediaId' => $mediaId,
            'authorId' => $owner['id'],
            'authorName' => $owner['name'],
            'authorUsername' => $owner['username'] ?? '',
            'authorAvatarUrl' => $owner['avatarUrl'] ?? null,
            'views' => 0,
            'createdAt' => new UTCDateTime(),
        ]);
        $post = mongoDatabase()->selectCollection('posts')->findOne(['_id' => $insert->getInsertedId()]);
        respond(['post' => postCard($post, $owner['id'])], 201);
    }

    if (preg_match('#^/api/posts/([a-f0-9]{24})/reaction$#i', $path, $matches) && $method === 'PUT') {
        $user = requireUser();
        $post = findPost($matches[1]);
        $input = requestJson();
        $reaction = (string) ($input['reaction'] ?? '');
        if (!in_array($reaction, ['heart', 'fire', 'gg'], true)) {
            respond(['error' => 'Choose a supported reaction.'], 422);
        }
        $reactions = mongoDatabase()->selectCollection('reactions');
        $filter = ['postId' => $post['_id'], 'userId' => $user['id']];
        $current = $reactions->findOne($filter);
        if (($current['reaction'] ?? null) === $reaction) {
            $reactions->deleteOne($filter);
        } else {
            $reactions->replaceOne(
                $filter,
                ['postId' => $post['_id'], 'userId' => $user['id'], 'reaction' => $reaction],
                ['upsert' => true],
            );
        }
        respond(['post' => postCard($post, $user['id'])]);
    }

    if (preg_match('#^/api/posts/([a-f0-9]{24})/comments$#i', $path, $matches) && $method === 'POST') {
        $user = requireUser();
        $post = findPost($matches[1]);
        $input = requestJson();
        $content = trim((string) ($input['content'] ?? ''));
        if ($content === '' || strlen($content) > 500) {
            respond(['error' => 'Comments must be between 1 and 500 characters.'], 422);
        }
        $insert = mongoDatabase()->selectCollection('comments')->insertOne([
            'postId' => $post['_id'],
            'userId' => $user['id'],
            'authorName' => $user['name'],
            'content' => $content,
            'createdAt' => new UTCDateTime(),
        ]);
        $comment = mongoDatabase()->selectCollection('comments')->findOne(['_id' => $insert->getInsertedId()]);
        respond(['comment' => commentCard($comment)], 201);
    }

    if (preg_match('#^/api/posts/([a-f0-9]{24})$#i', $path, $matches) && $method === 'DELETE') {
        requireOwner();
        $post = findPost($matches[1]);
        mongoDatabase()->selectCollection('comments')->deleteMany(['postId' => $post['_id']]);
        mongoDatabase()->selectCollection('reactions')->deleteMany(['postId' => $post['_id']]);
        mongoDatabase()->selectCollection('posts')->deleteOne(['_id' => $post['_id']]);
        gridFsBucket()->delete($post['mediaId']);
        respond(['ok' => true]);
    }

    if (preg_match('#^/api/media/([a-f0-9]{24})$#i', $path, $matches) && $method === 'GET') {
        $id = parseObjectId($matches[1]);
        $bucket = gridFsBucket();
        try {
            $file = $bucket->getFile($id);
            $stream = $bucket->openDownloadStream($id);
        } catch (Throwable) {
            respond(['error' => 'Media not found.'], 404);
        }
        $metadata = $file->getMetadata();
        $contentType = is_array($metadata)
            ? ($metadata['contentType'] ?? 'application/octet-stream')
            : ($metadata->contentType ?? 'application/octet-stream');
        if (!preg_match('#^(image/(jpeg|png|webp|gif)|video/(mp4|webm|quicktime))$#', (string) $contentType)) {
            $contentType = 'application/octet-stream';
        }
        header('Content-Type: ' . $contentType);
        header('Cache-Control: public, max-age=3600');
        if (isset($file->length)) {
            header('Content-Length: ' . (int) $file->length);
        }
        fpassthru($stream);
        fclose($stream);
        exit;
    }

    if (str_starts_with($path, '/api/')) {
        respond(['error' => 'API route not found.'], 404);
    }

    $index = __DIR__ . '/app.html';
    if (!is_file($index)) {
        http_response_code(503);
        echo 'The web app has not been built yet.';
        exit;
    }
    header('Content-Type: text/html; charset=utf-8');
    readfile($index);
}

try {
    routeRequest();
} catch (Throwable $error) {
    error_log('Shabs Gaming request failed: ' . get_class($error));
    respond(['error' => 'The request could not be completed. Check server configuration and try again.'], 500);
}
