import { defineModule } from "../bridge";
import { takeOpenedAtLaunch } from "../launchLinks";

defineModule("ArdiaLaunchLinks", {
  sync: { takeOpenedAtLaunch },
});
