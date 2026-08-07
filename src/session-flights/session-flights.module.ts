import { Module } from "@nestjs/common";
import { SessionFlightsController } from "./session-flights.controller";
import { SessionFlightsService } from "./session-flights.service";
import { DailyFlightPreChecksController } from "./precheck/daily-flight-prechecks.controller";
import { DailyFlightPreChecksService } from "./precheck/daily-flight-prechecks.service";
import { DailyFlightOperationsController } from "./operation/daily-flight-operations.controller";
import { DailyFlightOperationsService } from "./operation/daily-flight-operations.service";
import { DailyFlightOutChecksController } from "./outcheck/daily-flight-outchecks.controller";
import { DailyFlightOutChecksService } from "./outcheck/daily-flight-outchecks.service";
import { DailyFlightOutCheckSubmissionsController } from "./outcheck/submissions/daily-flight-outcheck-submissions.controller";
import { DailyFlightOutCheckSubmissionsService } from "./outcheck/submissions/daily-flight-outcheck-submissions.service";
import { DailyFlightOutCheckReviewsController } from "./outcheck/reviews/daily-flight-outcheck-reviews.controller";
import { DailyFlightOutCheckReviewsService } from "./outcheck/reviews/daily-flight-outcheck-reviews.service";
import { DailyFlightOutCheckReviewQueueController } from "./outcheck/review-queue/daily-flight-outcheck-review-queue.controller";
import { DailyFlightOutCheckReviewQueueService } from "./outcheck/review-queue/daily-flight-outcheck-review-queue.service";
import { DailyFlightOperationalIssuesController } from './operational-issues/daily-flight-operational-issues.controller';
import { DailyFlightOperationalIssuesService } from './operational-issues/daily-flight-operational-issues.service';

@Module({
  controllers: [
    SessionFlightsController,
    DailyFlightPreChecksController,
    DailyFlightOperationsController,
    DailyFlightOutChecksController,
    DailyFlightOutCheckSubmissionsController,
    DailyFlightOutCheckReviewsController,
    DailyFlightOutCheckReviewQueueController,
    DailyFlightOperationalIssuesController,
  ],
  providers: [
    SessionFlightsService,
    DailyFlightPreChecksService,
    DailyFlightOperationsService,
    DailyFlightOutChecksService,
    DailyFlightOutCheckSubmissionsService,
    DailyFlightOutCheckReviewsService,
    DailyFlightOutCheckReviewQueueService,
    DailyFlightOperationalIssuesService,
  ],
  exports: [SessionFlightsService],
})
export class SessionFlightsModule {}
