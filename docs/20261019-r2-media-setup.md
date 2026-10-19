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

All five must be set. If only some are set, the app refuses to start and names the missing ones.

Then redeploy the running version so the container picks up the new values:

```sh
ssh <host> 'cd ~/erc && ./deploy.sh "$(grep ^ERC_WEB_TAG= .env | cut -d= -f2)"'
```

## 5. Check it

1. In `/admin`, open **Records → Media** and upload an image with alt text.
2. Open the uploaded image. Its URL must start with `https://erc-media.gilla.fun/`.
3. In the R2 dashboard, the object appears in the `erc-media` bucket.

Images uploaded before the switch stay on the server's disk and keep working from there.
