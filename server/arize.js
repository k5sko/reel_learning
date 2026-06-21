// Arize — observability over the Claude reasoning calls.
//
// Every extraction / connection step runs inside an OpenTelemetry span using
// OpenInference LLM semantic conventions, exported to Arize over OTLP. In Arize
// these show up as LLM spans with their inputs, outputs, latency and a quality
// signal (did extraction yield memory points? did connection find links?) —
// which is how we catch the reasoning returning nothing useful and tune the
// prompts. That tuning loop is the "meaningfully improved the app" story.
//
// No ARIZE_* keys -> spans are logged to the console instead, so the trace is
// still visible in a zero-config demo.

import { config, flags } from './config.js'

// OpenInference attribute keys (stable strings; avoids a hard import).
const OI = {
  KIND: 'openinference.span.kind',
  INPUT: 'input.value',
  OUTPUT: 'output.value',
  MODEL: 'llm.model_name',
  PROVIDER: 'llm.provider',
}

let provider = null
let tracerPromise = null

async function getTracer() {
  if (!flags.arize) return null
  if (tracerPromise) return tracerPromise
  tracerPromise = (async () => {
    try {
      const [{ NodeTracerProvider }, { SimpleSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }, { ATTR_SERVICE_NAME }, { trace }] =
        await Promise.all([
          import('@opentelemetry/sdk-trace-node'),
          import('@opentelemetry/sdk-trace-base'),
          import('@opentelemetry/exporter-trace-otlp-proto'),
          import('@opentelemetry/resources'),
          import('@opentelemetry/semantic-conventions'),
          import('@opentelemetry/api'),
        ])

      const exporter = new OTLPTraceExporter({
        url: 'https://otlp.arize.com/v1/traces',
        headers: { space_id: config.arize.spaceId, api_key: config.arize.apiKey },
      })
      const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.arize.project,
        model_id: config.arize.project, // Arize AX project key
        model_version: '1.0.0',
        'openinference.project.name': config.arize.project,
      })
      provider = new NodeTracerProvider({
        resource,
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      })
      provider.register()
      console.log(`[arize] exporting spans to Arize project "${config.arize.project}"`)
      return trace.getTracer('reel-learning-memory')
    } catch (e) {
      console.error('[arize] tracer init failed, logging spans locally:', e.message)
      return null
    }
  })()
  return tracerPromise
}

const spans = []
export function recentSpans() {
  return spans.slice(-25)
}

// Flush pending spans (SimpleSpanProcessor exports eagerly, but call before a
// short-lived process exits to be safe).
export async function flushArize() {
  if (provider) {
    try {
      await provider.forceFlush()
    } catch {
      /* ignore */
    }
  }
}

function record(name, ok, durationMs, attrs, extra, errMsg) {
  const span = { name, durationMs, ok, ...attrs, ...extra, ...(errMsg ? { error: errMsg } : {}) }
  spans.push(span)
  const tag = ok ? 'span' : 'span!'
  const { name: _n, durationMs: _d, ok: _o, ...rest } = span
  console.log(`[arize:${tag}] ${name} ${durationMs}ms`, rest)
}

function safeEval(evaluate, result) {
  if (!evaluate) return {}
  try {
    return evaluate(result) || {}
  } catch {
    return {}
  }
}

// Wrap an async reasoning op in a traced span. `attrs` describe the input;
// `evaluate(result)` returns a small quality signal recorded on the span.
export async function trace(name, attrs, fn, evaluate) {
  const tracer = await getTracer()

  // No Arize: time it, record locally + console.
  if (!tracer) {
    const start = hrnow()
    try {
      const r = await fn()
      record(name, true, ms(start), attrs, safeEval(evaluate, r))
      return r
    } catch (e) {
      record(name, false, ms(start), attrs, {}, String(e.message || e))
      throw e
    }
  }

  // Arize: emit a real OpenInference LLM span.
  const { SpanStatusCode } = await import('@opentelemetry/api')
  return tracer.startActiveSpan(name, async (span) => {
    const start = hrnow()
    span.setAttribute(OI.KIND, 'LLM')
    span.setAttribute(OI.MODEL, config.anthropicModel)
    span.setAttribute(OI.PROVIDER, 'anthropic')
    span.setAttribute(OI.INPUT, safeStringify(attrs))
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(`memory.${k}`, asAttr(v))
    try {
      const r = await fn()
      const ev = safeEval(evaluate, r)
      span.setAttribute(OI.OUTPUT, safeStringify(r))
      for (const [k, v] of Object.entries(ev)) span.setAttribute(`eval.${k}`, asAttr(v))
      span.setStatus({ code: SpanStatusCode.OK })
      record(name, true, ms(start), attrs, ev)
      return r
    } catch (e) {
      span.recordException(e)
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e.message || e) })
      record(name, false, ms(start), attrs, {}, String(e.message || e))
      throw e
    } finally {
      span.end()
    }
  })
}

function asAttr(v) {
  return typeof v === 'object' ? JSON.stringify(v) : v
}
function safeStringify(v) {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return String(v)
  }
}
function hrnow() {
  const [s, ns] = process.hrtime()
  return s * 1000 + ns / 1e6
}
function ms(start) {
  return Math.round(hrnow() - start)
}
