import { onMount } from "solid-js"
import intro from "./chode-intro.mp4"

export function ChodeIntro(props: { class?: string; onEnded?: () => void; onError?: () => void }) {
  let video: HTMLVideoElement | undefined

  onMount(() => {
    if (!video) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    video.autoplay = true
    void video.play()
  })

  return (
    <video
      ref={video}
      data-slot="chode-intro"
      class={props.class}
      src={intro}
      muted
      playsinline
      preload="auto"
      onEnded={() => props.onEnded?.()}
      onError={() => props.onError?.()}
    />
  )
}
