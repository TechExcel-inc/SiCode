import { Show } from "solid-js"
import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { useSync } from "@/context/sync"
import { SessionProjectDock } from "@/pages/session/composer/session-project-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { projectSwitch, sessionSuggestion } from "@/pages/session/composer/session-project"
import { SessionSuggestDock } from "@/pages/session/composer/session-suggest-dock"

/**
 * A question the AI is waiting on, shown where the input box sits until it is answered.
 */
export function SessionQuestionCard(props: { request: QuestionRequest; onSubmit: () => void }) {
  const sync = useSync()
  return (
    <div data-component="session-question-card" class="w-full pt-2 pb-6">
      <Show
        when={sessionSuggestion(props.request, sync.data.part)}
        fallback={
          <Show
            when={projectSwitch(props.request, sync.data.part)}
            fallback={<SessionQuestionDock request={props.request} onSubmit={props.onSubmit} />}
          >
            {(target) => <SessionProjectDock request={props.request} target={target()} onSubmit={props.onSubmit} />}
          </Show>
        }
      >
        {(suggestion) => (
          <SessionSuggestDock request={props.request} suggestion={suggestion()} onSubmit={props.onSubmit} />
        )}
      </Show>
    </div>
  )
}
