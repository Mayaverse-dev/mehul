const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { execute, isPostgres } = require('../config/database');

let s3Client = null;

function getEnv(name) {
    return (process.env[name] || '').trim();
}

function getS3Client() {
    if (s3Client) return s3Client;

    const endpoint = getEnv('ENDPOINT_URL');
    const accessKeyId = getEnv('ACCESS_KEY_ID');
    const secretAccessKey = getEnv('SECRET_ACCESS_KEY');
    const region = getEnv('AWS_REGION') || getEnv('AWS_DEFAULT_REGION') || 'auto';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error('Missing S3 credentials/endpoint (ENDPOINT_URL, ACCESS_KEY_ID, SECRET_ACCESS_KEY)');
    }

    s3Client = new S3Client({
        region,
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // Many S3-compatible providers require path-style addressing.
        forcePathStyle: true
    });

    return s3Client;
}

function resolveBookKey(format) {
    const fmt = String(format || '').toLowerCase();
    if (fmt === 'pdf-compressed') return getEnv('EBOOK_PDF_COMPRESSED_KEY');
    if (fmt === 'pdf') return getEnv('EBOOK_PDF_KEY');
    if (fmt === 'epub') return getEnv('EBOOK_EPUB_KEY');
    if (fmt === 'dictionary' || fmt === 'mobi') {
        // Prefer an explicit key, but default to "same path" as the other eBook files.
        const override = getEnv('EBOOK_DICTIONARY_KEY');
        if (override) return override;

        const epubKey = getEnv('EBOOK_EPUB_KEY');
        const pdfKey = getEnv('EBOOK_PDF_KEY');
        const baseKey = (function dirnameKey(key) {
            const k = String(key || '').trim();
            if (!k) return '';
            const idx = k.lastIndexOf('/');
            if (idx < 0) return '';
            return k.slice(0, idx);
        })(epubKey) || (function dirnameKey(key) {
            const k = String(key || '').trim();
            if (!k) return '';
            const idx = k.lastIndexOf('/');
            if (idx < 0) return '';
            return k.slice(0, idx);
        })(pdfKey);

        // If we can't infer a directory, fall back to bucket root.
        return baseKey ? `${baseKey}/maya_dictionary.mobi` : 'maya_dictionary.mobi';
    }
    return '';
}

async function getPresignedDownloadUrl({ format }) {
    const bucket = getEnv('BUCKET_NAME');
    if (!bucket) throw new Error('Missing BUCKET_NAME');

    const key = resolveBookKey(format);
    if (!key) throw new Error(`Missing eBook key for format '${format}' (set EBOOK_PDF_KEY / EBOOK_EPUB_KEY)`);

    const ttlRaw = getEnv('EBOOK_URL_TTL_SECONDS');
    const ttlSeconds = Math.max(30, Math.min(60 * 60, parseInt(ttlRaw || '300', 10) || 300));

    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: 'attachment'
    });

    const url = await getSignedUrl(getS3Client(), command, { expiresIn: ttlSeconds });
    return url;
}

async function logDownloadEvent({ userId, eventType, format, country, userAgent }) {
    const table = isPostgres() ? 'ebook.download_events' : 'ebook_download_events';
    const type = String(eventType || 'download_url_issued').slice(0, 64);
    const fmt = String(format || '').toLowerCase();
    const ua = String(userAgent || '').slice(0, 1000);
    const ctry = country ? String(country).slice(0, 10) : null;

    try {
        await execute(
            `INSERT INTO ${table} (user_id, event_type, format, country, user_agent)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, type, fmt, ctry, ua]
        );
    } catch (err) {
        // Best-effort: don't block downloads if metrics table isn't ready yet.
        const msg = err?.message || '';
        if (msg.includes('does not exist') || msg.includes('no such table')) return;
        console.warn('⚠️  Failed to log eBook download event:', msg);
    }
}

module.exports = {
    getPresignedDownloadUrl,
    logDownloadEvent
};

