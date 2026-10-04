> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Migrate from Sonar to the Agent API

> The Agent API represents a major upgrade of Sonar Chat Completions, bringing added configuration and powerful agentic primitives to your AI applications.

The Agent API is more performant and cost-effective for production workloads. It features Perplexity's latest innovations in search and reasoning technology, including Search as Code and tuned presets.

<Note>
  We recommend:

  * Migrating existing Sonar Chat Completions usage to the Agent API.
  * Using the Agent API for all new projects.
</Note>

<Note>
  Sonar Chat Completions support ended on September 27, 2026. Synchronous and streaming requests keep working: they are being reformulated as Agent API requests, rolling out gradually by model. Asynchronous Sonar requests are not reformulated and are no longer supported; move them to [background mode](/docs/agent-api/background-mode).
</Note>

## About the Agent API

Agent API is a unified interface for building powerful agent applications.

It contains:

* One API to call all the leading frontier and open-source models.
* Built-in tools such as [web search](/docs/agent-api/tools/web-search), [URL fetching](/docs/agent-api/tools/fetch-url-content), [sandboxes](/docs/agent-api/tools/sandbox), and [MCP](/docs/agent-api/tools/mcp), plus premium data sources like [finance](/docs/agent-api/tools/finance-search) and [people search](/docs/agent-api/tools/people-search).
* Research-backed configurations for agentic workflows, based on specific task intensity (fast, low, medium, high, xhigh — [presets](/docs/agent-api/presets)).
* Compatibility with the [Open Responses](https://www.openresponses.org/) standard to ensure portability and avoid lock-in — we want to win your business on performance and efficiency, not on locking you in with exorbitant migration costs.
* Seamless multi-turn interactions that let you [pass previous responses](/docs/agent-api/conversation-state#resume-from-a-prior-response) for higher-accuracy reasoning.

## Why migrate

Agent API contains several benefits over Sonar Chat Completions:

* Full flexibility to select across the OpenAI, Anthropic, Google, xAI, Z.AI, Moonshot AI, and NVIDIA model families, in addition to Perplexity's Sonar model.
* The ability to leverage multiple tools and spin up an agentic loop that reasons, acts, observes results, and continues within a single request.
* A secure [sandbox](/docs/agent-api/tools/sandbox) to run generated code — compute results, analyze data, and verify outputs without leaving the request.
* Connect external servers with [MCP](/docs/agent-api/tools/mcp) or define your own [custom functions](/docs/agent-api/tools/custom-functions) to extend the agent with your tools and private data.

## Sonar vs Agent API

| Capability | Sonar API | Agent API |
| - | :-: | :-: |
| Leading frontier and open-source models | | <Icon icon="check" /> |
| Built-in web search | <Icon icon="check" /> | <Icon icon="check" /> |
| People Search | | <Icon icon="check" /> |
| Finance Search | | <Icon icon="check" /> |
| Code sandbox | | <Icon icon="check" /> |
| MCP servers | | <Icon icon="check" /> |
| Model fallback | | <Icon icon="check" /> |
| Structured outputs | <Icon icon="check" /> | <Icon icon="check" /> |
| Streaming | <Icon icon="check" /> | <Icon icon="check" /> |
| Async mode | | <Icon icon="check" /> |

Both call a model but shape the request differently.
Sonar takes a `messages` array and returns `choices`.
The Agent API takes an `input` and returns a typed `output` array — one item per step the model took, with a `message` item for the answer text and a `search_results` item for the sources.

<Columns cols={2}>
  <div>
    **Sonar**

    <CodeGroup>
      ```python Python theme={null}
      from perplexity import Perplexity

      client = Perplexity()

      completion = client.chat.completions.create(
          model="sonar",
          messages=[{"role": "user", "content": "What are the latest developments in AI agents?"}]
      )
      print(completion.choices[0].message.content)
      ```

      ```typescript Typescript theme={null}
      import Perplexity from '@perplexity-ai/perplexity_ai';

      const client = new Perplexity();

      const completion = await client.chat.completions.create({
        model: 'sonar',
        messages: [{ role: 'user', content: 'What are the latest developments in AI agents?' }]
      });
      console.log(completion.choices[0].message.content);
      ```

      ```bash cURL theme={null}
      curl https://api.perplexity.ai/v1/sonar \
        -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "sonar",
          "messages": [
            {"role": "user", "content": "What are the latest developments in AI agents?"}
          ]
        }' | jq
      ```
    </CodeGroup>
  </div>

  <div>
    **Agent API**

    <CodeGroup>
      ```python Python theme={null}
      from perplexity import Perplexity

      client = Perplexity()

      response = client.responses.create(
          preset="fast",
          input="What are the latest developments in AI agents?"
      )
      print(response.output_text)
      ```

      ```typescript Typescript theme={null}
      import Perplexity from '@perplexity-ai/perplexity_ai';

      const client = new Perplexity();

      const response = await client.responses.create({
        preset: 'fast',
        input: 'What are the latest developments in AI agents?'
      });
      console.log(response.output_text);
      ```

      ```bash cURL theme={null}
      curl https://api.perplexity.ai/v1/agent \
        -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "preset": "fast",
          "input": "What are the latest developments in AI agents?"
        }' | jq
      ```
    </CodeGroup>
  </div>
</Columns>

<Tabs>
  <Tab title="Sonar response">
    ```json theme={null}
    {
      "id": "8158ec84-87a8-40fd-8720-a8b8e628708c",
      "choices": [
        {
          // ...
          "message": {"content": "The latest developments in AI agents (as of July 2026) center on **massive model upgrades**, **open-source toolkits**, **real-world autonomous transactions**, and **enterprise-grade security frameworks** ...", "role": "assistant"},
          "finish_reason": "stop"
        }
      ],
      "created": 1784292153,
      "model": "sonar",
      "citations": [
        "https://medium.com/@agencyai/this-weeks-ai-agent-roundup-20-launches-and-updates-you-shouldn-t-miss-401202306f62",
        "https://www.itechmagazine.com/ai-agents-news/"
        // ...
      ],
      "object": "chat.completion",
      "search_results": [
        {"title": "AI Agents News 2026: What's Happening Right Now and Why It ...", "url": "https://www.itechmagazine.com/ai-agents-news/", "date": "2026-06-14", "last_updated": "2026-06-21", "snippet": "Amazon Web Services open-sourced its Strands Agents SDK, a toolkit that helps developers b ...", "source": "web", "place_metadata": null}
        // ...
      ]
      // ...
    }
    ```
  </Tab>

  <Tab title="Agent API response">
    ```json theme={null}
    {
      "id": "resp_18690c07-7c56-48fa-85a3-fd22e34df694",
      "created_at": 1784292159,
      "model": "openai/gpt-5.6-luna",
      "object": "response",
      "output": [
        {
          "results": [
            {"id": 1, "snippet": "This transition from one-shot intelligence to endurance, from conversational AI to genuine autonomy ...", "title": "State of AI Agents 2026: Autonomy is Here", "url": "https://www.prosus.com/news-insights/2026/state-of-ai-agents-2026-autonomy-is-here", "date": "2026-02-26", "last_updated": "2026-07-12", "source": "web"}
            // ...
          ],
          "type": "search_results"
          // ...
        },
        {
          "id": "msg_525b46ea-4e33-400b-add0-6862a48549b9",
          "content": [
            {"text": "The latest developments in AI agents are centered on **greater autonomy, better orchestration, and stronger enterprise controls**[1][3] ...", "type": "output_text", "annotations": []}
          ],
          "role": "assistant",
          "status": "completed",
          "type": "message"
        }
      ],
      "status": "completed"
      // ...
    }
    ```
  </Tab>
</Tabs>

## How Sonar Chat Completions maps to Agent API presets

While performance improvements will vary by individual use-case, our internal benchmarks indicate performance improvements across the below comparable Sonar Chat Completions and Agent API preset mappings.

| Sonar Chat Completions | Agent API preset | Best for | What improves |
| - | - | - | - |
| Sonar | `fast` | Single-fact lookups, definitions, quick summaries. | More accurate than Sonar, with the clearest gains on research-style, multi-step questions. |
| Sonar Pro | `fast` | Everyday research questions, light multi-step lookups with current information. | Much more accurate, and unlocks the real multi-step, agentic research that Sonar Pro can't reach. |
| Sonar Reasoning Pro | `low` | Multi-hop browsing and wide aggregation across many sources. | Far stronger on step-by-step reasoning and on chaining evidence across several rounds of search. |
| Sonar Deep Research | `high` | Expert-level reasoning and exhaustive source coverage. | The most accurate tier on demanding expert-level and deep-research work, and often at a lower per-request cost than Sonar Deep Research. |

<Tip>
  For state-of-the-art deep research, use the `xhigh` preset — the highest quality in the lineup, leading across the benchmarks we run.
</Tip>

See [Choosing a preset](/docs/agent-api/presets#choosing-a-preset) for what each preset is best for, and the [benchmarks page](/docs/agent-api/migrate-from-sonar/benchmarks) for the scores.

## Continue your migration

<CardGroup cols={2}>
  <Card title="How to migrate" icon="arrow-right-arrow-left" href="/docs/agent-api/migrate-from-sonar/how-to">
    Follow the complete field-by-field migration procedure and parameter reference.
  </Card>

  <Card title="Explore the presets" icon="sliders" href="/docs/agent-api/presets">
    See what each preset configures and how to override individual settings.
  </Card>
</CardGroup>
