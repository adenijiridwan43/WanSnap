import { VideoUploader } from '../components/videoUploader'
import { HowToUse } from '../components/HowToUse/howToUse'

function Welcome() {

  return (
    <>
     <div className="min-h-screen bg-[#28293D]">
      <VideoUploader />
      <HowToUse />
    </div>
    </>
  )
}

export default Welcome
