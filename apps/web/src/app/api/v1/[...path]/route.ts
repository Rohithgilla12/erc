import { handleV1 } from '@/members/http'

type Context = { params: Promise<{ path: string[] }> }

// A static `v1` segment wins over Payload's `(payload)/api/[...slug]` catch-all, so these never reach Payload's REST API.
const handle = async (request: Request, { params }: Context) => handleV1(request, (await params).path)

export const GET = handle
export const POST = handle
