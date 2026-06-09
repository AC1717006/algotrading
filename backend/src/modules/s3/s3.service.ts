import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { S3UploadResult } from '../../types';

const log = logger.child({ category: 'S3Service' });

class S3Service {
  private client: S3Client | null = null;
  private bucket: string;
  private enabled: boolean;

  constructor() {
    this.bucket = config.AWS_S3_BUCKET;
    this.enabled = !!(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY && config.AWS_S3_BUCKET);

    if (this.enabled) {
      this.client = new S3Client({
        region: config.AWS_REGION,
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      });
      log.info('S3 client initialized', { bucket: this.bucket, region: config.AWS_REGION });
    } else {
      log.debug('S3 not configured — file uploads disabled');
    }
  }

  private get isReady(): boolean {
    return this.enabled && this.client !== null;
  }

  async verifyBucket(): Promise<boolean> {
    if (!this.isReady) return false;
    try {
      await this.client!.send(new HeadBucketCommand({ Bucket: this.bucket }));
      log.info('S3 bucket verified', { bucket: this.bucket });
      return true;
    } catch {
      log.error('S3 bucket not accessible', { bucket: this.bucket });
      return false;
    }
  }

  async uploadBuffer(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<S3UploadResult | null> {
    if (!this.isReady) { log.debug('S3 upload skipped — not configured'); return null; }
    try {
      await this.client!.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }));
      const url = `https://${this.bucket}.s3.${config.AWS_REGION}.amazonaws.com/${key}`;
      log.info('S3 upload success', { key });
      return { key, bucket: this.bucket, url };
    } catch (err) {
      log.error('S3 upload failed', { key, err });
      return null;
    }
  }

  async uploadText(key: string, text: string, contentType = 'text/plain'): Promise<S3UploadResult | null> {
    return this.uploadBuffer(key, Buffer.from(text, 'utf-8'), contentType);
  }

  async uploadJson(key: string, data: unknown): Promise<S3UploadResult | null> {
    return this.uploadText(key, JSON.stringify(data, null, 2), 'application/json');
  }

  async uploadCsv(key: string, csv: string): Promise<S3UploadResult | null> {
    return this.uploadText(key, csv, 'text/csv');
  }

  async download(key: string): Promise<string | null> {
    if (!this.isReady) return null;
    try {
      const resp = await this.client!.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const stream = resp.Body;
      if (!stream) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    } catch (err) {
      log.error('S3 download failed', { key, err });
      return null;
    }
  }

  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string | null> {
    if (!this.isReady) return null;
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return getSignedUrl(this.client!, command, { expiresIn: expiresInSeconds });
    } catch (err) {
      log.error('Presigned URL generation failed', { key, err });
      return null;
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    if (!this.isReady) return [];
    try {
      const resp = await this.client!.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }));
      return (resp.Contents ?? []).map((obj) => obj.Key!).filter(Boolean);
    } catch {
      return [];
    }
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.isReady) return;
    try {
      await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      log.info('S3 object deleted', { key });
    } catch (err) {
      log.error('S3 delete failed', { key, err });
    }
  }

  // ─── Domain-specific helpers ─────────────────────────────────────────────────
  async uploadTradeReport(userId: string, csvData: string): Promise<S3UploadResult | null> {
    const date = new Date().toISOString().split('T')[0];
    const key = `reports/${userId}/trades-${date}.csv`;
    return this.uploadCsv(key, csvData);
  }

  async uploadDailyLogs(logContent: string): Promise<S3UploadResult | null> {
    const date = new Date().toISOString().split('T')[0];
    const key = `logs/${date}/combined.log`;
    return this.uploadText(key, logContent);
  }

  async getTradeReportUrl(userId: string, date: string): Promise<string | null> {
    const key = `reports/${userId}/trades-${date}.csv`;
    return this.getPresignedUrl(key);
  }
}

export const s3Service = new S3Service();
