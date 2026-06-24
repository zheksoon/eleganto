import { IOptions } from "./types";
import { setReactionExceptionHandler, setReactionScheduler } from "./schedulers";

export const configure = (options: IOptions): void => {
  if (options.reactionScheduler) {
    setReactionScheduler(options.reactionScheduler);
  }
  if (options.reactionExceptionHandler) {
    setReactionExceptionHandler(options.reactionExceptionHandler);
  }
};
