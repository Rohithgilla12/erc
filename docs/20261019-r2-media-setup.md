# Move media uploads to Cloudflare R2

Payload stores uploaded images on the server's disk until R2 is configured. After these steps, uploads go to an R2 bucket and are served from Cloudflare's edge at your media domain. R2's free tier covers 10 GB of storage with no egress fees.

Dashboard labels were checked against Cloudflare's documentation on 2026-10-19: [API tokens](https://developers.cloudflare.com/r2/api/tokens/) and [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).

## 1. Create the bucket

1. In the Cloudflare dashboard, open **R2 object storage**.
2. Create a bucket named `erc-media`. Leave the jurisdiction as the default; the app expects the default endpoint.

## 2. Give it a public domain

1. Open the bucket and select **Settings**.
2. Under **Custom Domains**, select **Add**.
3. Enter `erc-media.gilla.fun` and select **Continue**, then **Connect Domain**.
4. Wait until the status changes from **Initializing** to **Active**.

Use a name one level under the zone (`erc-media.gilla.fun`, not `media.erc.gilla.fun`); Cloudflare's free certificate covers only one level of subdomain. Do not use the `r2.dev` URL; Cloudflare describes it as for non-production traffic.

## 3. Create an API token for the app

1. On the **R2 object storage** overview, under **Account Details**, select **Manage** next to **API Tokens**.
2. Select **Create Account API token**.
3. Under **Permissions**, select **Object Read & Write**, and limit it to the `erc-media` bucket.
4. Create the token. Copy the **Access Key ID** and the **Secret Access Key** into 1Password. The secret is shown only once.
5. Note the S3 endpoint, `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Your account ID is on the R2 overview page.

## 4. Configure the server

Add these five lines to the server's `.env` (on the production host, `~/erc/.env`). Edit the file on the server; do not paste the secret into chat, tickets, or commits.

```sh
R2_BUCKET=erc-media
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<from 1Password>
R2_SECRET_ACCESS_KEY=<from 1Password>
R2_PUBLIC_URL=https://erc-media.gilla.fun
```

All five must be set. If only some are set, the app refuses to start and names the missing ones. Do not redeploy yet.

## 5. Copy existing uploads into the bucket

Once R2 is on, the app builds every image URL from `R2_PUBLIC_URL` and reads every download from the bucket, including files uploaded before the switch. Files left only on the server's disk break: their images return 404 and their downloads fail with a server error. Copy them before you switch.

The bucket uses the same layout as the uploads folder: images at the top, downloads under `resources/`. A plain sync is enough. This command runs the AWS CLI in a throwaway container and reads the R2 values from `.env`:

```sh
ssh <host> 'cd ~/erc && docker run --rm --env-file .env -v /data/media/erc/uploads:/uploads:ro --entrypoint sh amazon/aws-cli -c '\''AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" aws s3 sync /uploads "s3://$R2_BUCKET" --endpoint-url "$R2_ENDPOINT" --region auto'\'''
```

The sync copies only missing or changed files, so it is safe to run again.

## 6. Switch

Redeploy the running version so the container picks up the new values:

```sh
ssh <host> 'cd ~/erc && ./deploy.sh "$(grep ^ERC_WEB_TAG= .env | cut -d= -f2)"'
```

Then run the step 5 command again. It copies anything uploaded between the first copy and the redeploy.

Keep `/data/media/erc/uploads` on the server. Pages cached before the switch still link images at `/api/media/file/...`, and the app keeps serving those from disk until each page refreshes.

## 7. Check it

1. In `/admin`, open **Records → Media** and upload an image with alt text.
2. Open the uploaded image. Its URL must start with `https://erc-media.gilla.fun/`.
3. In the R2 dashboard, the object appears in the `erc-media` bucket.
4. Open a page that showed an image before the switch, such as a coach profile. The image still loads.
5. Open a download from `/resources`. The file still downloads.

To rehearse the whole switch locally against any S3-compatible store, run `apps/web/src/scripts/check-r2.ts` (see the README).
