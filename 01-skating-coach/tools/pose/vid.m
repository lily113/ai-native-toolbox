#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <Vision/Vision.h>
#import <AppKit/AppKit.h>

static void writePNG(CGImageRef img, NSString *path) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:img];
  NSData *d = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  [d writeToFile:path atomically:YES];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 3) { printf("usage: vid <file> <mode> [args]\n"); return 1; }
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSString *mode = [NSString stringWithUTF8String:argv[2]];
    NSURL *url = [NSURL fileURLWithPath:path];
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
    Float64 dur = CMTimeGetSeconds(asset.duration);

    if ([mode isEqualToString:@"meta"]) {
      printf("duration: %.2f s\n", dur);
      NSArray *tracks = [asset tracksWithMediaType:AVMediaTypeVideo];
      if (tracks.count) {
        AVAssetTrack *t = tracks[0];
        CGSize sz = CGSizeApplyAffineTransform(t.naturalSize, t.preferredTransform);
        printf("size: %dx%d\n", (int)fabs(sz.width), (int)fabs(sz.height));
        printf("fps: %.2f\n", t.nominalFrameRate);
        printf("bitrate: %d kbps\n", (int)(t.estimatedDataRate/1000));
      } else printf("no video track\n");
      return 0;
    }

    AVAssetImageGenerator *gen = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
    gen.appliesPreferredTrackTransform = YES;
    gen.requestedTimeToleranceBefore = CMTimeMakeWithSeconds(1.0/120.0, 600);
    gen.requestedTimeToleranceAfter  = CMTimeMakeWithSeconds(1.0/120.0, 600);

    if ([mode isEqualToString:@"frames"]) {
      NSString *outDir = [NSString stringWithUTF8String:argv[3]];
      double step = argc > 4 ? atof(argv[4]) : 0.5;
      int i = 0;
      for (double t = 0; t < dur; t += step) {
        NSError *err = nil;
        CGImageRef img = [gen copyCGImageAtTime:CMTimeMakeWithSeconds(t, 600) actualTime:nil error:&err];
        if (img) {
          writePNG(img, [NSString stringWithFormat:@"%@/f%03d.png", outDir, i]);
          CGImageRelease(img);
        }
        i++;
      }
      printf("frames written: %d\n", i);
      return 0;
    }

    if ([mode isEqualToString:@"pose3"]) {
      NSString *outFile = [NSString stringWithUTF8String:argv[3]];
      double fps = 30.0;
      NSArray *tk3 = [asset tracksWithMediaType:AVMediaTypeVideo];
      if (tk3.count) { AVAssetTrack *vt = (AVAssetTrack *)tk3[0]; if (vt.nominalFrameRate > 1) fps = vt.nominalFrameRate; }
      int step = argc > 4 ? atoi(argv[4]) : 3;
      int total = (int)floor(dur * fps);
      NSMutableArray *lines = [NSMutableArray array];
      int fail = 0;
      for (int i = 0; i < total; i += step) {
        double t = (double)i / fps;
        AVAssetImageGenerator *g2 = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];   // 每帧新建，避开 seek 状态
        g2.appliesPreferredTrackTransform = YES;
        g2.requestedTimeToleranceBefore = CMTimeMake(1, 600);
        g2.requestedTimeToleranceAfter  = CMTimeMake(1, 600);
        NSError *err = nil;
        CGImageRef img = [g2 copyCGImageAtTime:CMTimeMakeWithSeconds(t, 600) actualTime:nil error:&err];
        if (!img) { fail++; continue; }
        VNImageRequestHandler *h = [[VNImageRequestHandler alloc] initWithCGImage:img options:@{}];
        VNDetectHumanBodyPoseRequest *req = [[VNDetectHumanBodyPoseRequest alloc] init];
        NSMutableDictionary *obj = [NSMutableDictionary dictionary];
        obj[@"t"] = @(t); obj[@"i"] = @(i);
        obj[@"w"] = @(CGImageGetWidth(img)); obj[@"h"] = @(CGImageGetHeight(img));
        NSError *perr = nil;
        if ([h performRequests:@[req] error:&perr] && req.results.count) {
          VNHumanBodyPoseObservation *obs = req.results[0];
          NSDictionary *all = [obs recognizedPointsForGroupKey:VNHumanBodyPoseObservationJointsGroupNameAll error:nil];
          NSMutableDictionary *pts = [NSMutableDictionary dictionary];
          for (VNHumanBodyPoseObservationJointName k in all) {
            VNRecognizedPoint *p = all[k];
            pts[k] = @[@(p.location.x), @(p.location.y), @(p.confidence)];
          }
          obj[@"points"] = pts; obj[@"conf"] = @(obs.confidence);
        }
        NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
        [lines addObject:[[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding]];
        CGImageRelease(img);
      }
      [[lines componentsJoinedByString:@"\n"] writeToFile:outFile atomically:YES encoding:NSUTF8StringEncoding error:nil];
      printf("total: %d  sampled: %d  failed: %d  outputs: %lu\n", total, (total+step-1)/step, fail, (unsigned long)lines.count);
      return 0;
    }

    if ([mode isEqualToString:@"pose2"]) {
      NSString *outFile = [NSString stringWithUTF8String:argv[3]];
      double fps = 30.0;
      NSArray *tk = [asset tracksWithMediaType:AVMediaTypeVideo];
      if (tk.count) {
        AVAssetTrack *vt = (AVAssetTrack *)tk[0];
        if (vt.nominalFrameRate > 1) fps = vt.nominalFrameRate;
      }
      int step = argc > 4 ? atoi(argv[4]) : 3;              // 每 N 帧取 1 帧
      int total = (int)floor(dur * fps);
      NSMutableArray *lines = [NSMutableArray array];
      int ok = 0, fail = 0;
      for (int i = 0; i < total; i += step) {
        double t = (double)i / fps;
        NSError *err = nil;
        CGImageRef img = [gen copyCGImageAtTime:CMTimeMakeWithSeconds(t, fps) actualTime:nil error:&err];
        if (!img) { fail++; continue; }
        VNImageRequestHandler *h = [[VNImageRequestHandler alloc] initWithCGImage:img options:@{}];
        VNDetectHumanBodyPoseRequest *req = [[VNDetectHumanBodyPoseRequest alloc] init];
        NSMutableDictionary *obj = [NSMutableDictionary dictionary];
        obj[@"t"] = @(t);
        obj[@"i"] = @(i);
        obj[@"w"] = @(CGImageGetWidth(img));
        obj[@"h"] = @(CGImageGetHeight(img));
        NSError *perr = nil;
        if ([h performRequests:@[req] error:&perr] && req.results.count) {
          VNHumanBodyPoseObservation *obs = req.results[0];
          NSDictionary *all = [obs recognizedPointsForGroupKey:VNHumanBodyPoseObservationJointsGroupNameAll error:nil];
          NSMutableDictionary *pts = [NSMutableDictionary dictionary];
          for (VNHumanBodyPoseObservationJointName k in all) {
            VNRecognizedPoint *p = all[k];
            pts[k] = @[@(p.location.x), @(p.location.y), @(p.confidence)];
          }
          obj[@"points"] = pts;
          obj[@"conf"] = @(obs.confidence);
        }
        NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
        [lines addObject:[[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding]];
        ok++;
        CGImageRelease(img);
      }
      [[lines componentsJoinedByString:@"\n"] writeToFile:outFile atomically:YES encoding:NSUTF8StringEncoding error:nil];
      printf("fps: %.2f  total frames: %d  sampled: %d  failed: %d  outputs: %lu\n", fps, total, ok+fail, fail, (unsigned long)lines.count);
      return 0;
    }

    if ([mode isEqualToString:@"pose4"]) {
      NSString *outFile = [NSString stringWithUTF8String:argv[3]];
      double fps = 30.0;
      NSArray *tk4 = [asset tracksWithMediaType:AVMediaTypeVideo];
      if (tk4.count) { AVAssetTrack *vt = (AVAssetTrack *)tk4[0]; if (vt.nominalFrameRate > 1) fps = vt.nominalFrameRate; }
      int step = argc > 4 ? atoi(argv[4]) : 3;
      int total = (int)floor(dur * fps);
      NSMutableArray *times = [NSMutableArray array];
      for (int i = 0; i < total; i += step) [times addObject:[NSValue valueWithCMTime:CMTimeMakeWithSeconds((double)i/fps, 600)]];
      AVAssetImageGenerator *gb = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
      gb.appliesPreferredTrackTransform = YES;
      gb.requestedTimeToleranceBefore = CMTimeMakeWithSeconds(1.0/60.0, 600);
      gb.requestedTimeToleranceAfter  = CMTimeMakeWithSeconds(1.0/60.0, 600);
      NSMutableArray *lines = [NSMutableArray array];
      __block int ok = 0, fail = 0;
      NSLock *lock = [[NSLock alloc] init];
      dispatch_semaphore_t sem = dispatch_semaphore_create(0);
      __block int remaining = (int)times.count;
      [gb generateCGImagesAsynchronouslyForTimes:times completionHandler:^(CMTime requestedTime, CGImageRef img, CMTime actualTime, AVAssetImageGeneratorResult result, NSError *err) {
        if (result == AVAssetImageGeneratorSucceeded && img) {
          VNImageRequestHandler *h = [[VNImageRequestHandler alloc] initWithCGImage:img options:@{}];
          VNDetectHumanBodyPoseRequest *req = [[VNDetectHumanBodyPoseRequest alloc] init];
          NSMutableDictionary *obj = [NSMutableDictionary dictionary];
          obj[@"t"] = @(CMTimeGetSeconds(actualTime));
          obj[@"w"] = @(CGImageGetWidth(img)); obj[@"h"] = @(CGImageGetHeight(img));
          if ([h performRequests:@[req] error:nil] && req.results.count) {
            VNHumanBodyPoseObservation *obs = req.results[0];
            NSDictionary *all = [obs recognizedPointsForGroupKey:VNHumanBodyPoseObservationJointsGroupNameAll error:nil];
            NSMutableDictionary *pts = [NSMutableDictionary dictionary];
            for (VNHumanBodyPoseObservationJointName k in all) {
              VNRecognizedPoint *p = all[k];
              pts[k] = @[@(p.location.x), @(p.location.y), @(p.confidence)];
            }
            obj[@"points"] = pts; obj[@"conf"] = @(obs.confidence);
          }
          NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
          [lock lock]; [lines addObject:[[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding]]; ok++; [lock unlock];
        } else { [lock lock]; fail++; [lock unlock]; }
        if (--remaining <= 0) dispatch_semaphore_signal(sem);
      }];
      dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
      [[lines componentsJoinedByString:@"\n"] writeToFile:outFile atomically:YES encoding:NSUTF8StringEncoding error:nil];
      printf("batch: requested %lu  ok: %d  failed: %d\n", (unsigned long)times.count, ok, fail);
      return 0;
    }

    if ([mode isEqualToString:@"transcode"]) {
      NSString *outPath = [NSString stringWithUTF8String:argv[3]];
      [[NSFileManager defaultManager] removeItemAtPath:outPath error:nil];
      AVAssetExportSession *ex = [[AVAssetExportSession alloc] initWithAsset:asset presetName:AVAssetExportPreset1280x720];
      ex.outputURL = [NSURL fileURLWithPath:outPath];
      ex.outputFileType = AVFileTypeMPEG4;
      ex.shouldOptimizeForNetworkUse = NO;
      dispatch_semaphore_t sem = dispatch_semaphore_create(0);
      [ex exportAsynchronouslyWithCompletionHandler:^{ dispatch_semaphore_signal(sem); }];
      dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
      if (ex.status == AVAssetExportSessionStatusCompleted) { printf("transcoded ok -> %s\n", argv[3]); return 0; }
      printf("transcode failed: %ld %s\n", (long)ex.status, [[ex.error localizedDescription] UTF8String]);
      return 1;
    }

    if ([mode isEqualToString:@"pose"]) {
      NSString *outFile = [NSString stringWithUTF8String:argv[3]];
      int every = argc > 4 ? atoi(argv[4]) : 3;          // 每 N 帧取 1 帧（30fps → 每 3 帧 = 10fps）
      NSArray *tracks = [asset tracksWithMediaType:AVMediaTypeVideo];
      if (!tracks.count) { printf("no video track\n"); return 1; }
      {
        AVAssetTrack *vt0 = (AVAssetTrack *)tracks[0];
        NSArray *fmts = [vt0 formatDescriptions];
        if (fmts.count) {
          CMFormatDescriptionRef f = (__bridge CMFormatDescriptionRef)fmts[0];
          const char *codec = CMFormatDescriptionGetMediaSubType(f) == kCMVideoCodecType_H264 ? "H264" :
                              (CMFormatDescriptionGetMediaSubType(f) == kCMVideoCodecType_HEVC ? "HEVC" : "other");
          CMVideoDimensions dim = CMVideoFormatDescriptionGetDimensions(f);
          printf("codec: %s  %dx%d\n", codec, dim.width, dim.height);
        }
        printf("nominalFrameRate: %.2f  timeRange: %.2f-%.2f s\n", vt0.nominalFrameRate,
               CMTimeGetSeconds(vt0.timeRange.start), CMTimeGetSeconds(vt0.timeRange.duration));
      }
      NSError *rerr = nil;
      AVAssetReader *reader = [AVAssetReader assetReaderWithAsset:asset error:&rerr];
      NSDictionary *opts = @{(id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)};
      AVAssetReaderTrackOutput *out = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:tracks[0] outputSettings:opts];
      out.alwaysCopiesSampleData = YES;
      [reader addOutput:out];
      [reader startReading];
      NSMutableArray *lines = [NSMutableArray array];
      int idx = 0, used = 0;
      while (reader.status == AVAssetReaderStatusReading) {
        CMSampleBufferRef sb = [out copyNextSampleBuffer];
        if (!sb) break;
        if (idx % every == 0) {
          CVImageBufferRef pb = CMSampleBufferGetImageBuffer(sb);
          if (pb) {
            Float64 t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb));
            VNImageRequestHandler *h = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pb options:@{}];
            VNDetectHumanBodyPoseRequest *req = [[VNDetectHumanBodyPoseRequest alloc] init];
            NSMutableDictionary *obj = [NSMutableDictionary dictionary];
            obj[@"t"] = @(t);
            obj[@"w"] = @(CVPixelBufferGetWidth(pb));
            obj[@"h"] = @(CVPixelBufferGetHeight(pb));
            NSError *perr = nil;
            if ([h performRequests:@[req] error:&perr] && req.results.count) {
              VNHumanBodyPoseObservation *obs = req.results[0];
              NSDictionary *all = [obs recognizedPointsForGroupKey:VNHumanBodyPoseObservationJointsGroupNameAll error:nil];
              NSMutableDictionary *pts = [NSMutableDictionary dictionary];
              for (VNHumanBodyPoseObservationJointName k in all) {
                VNRecognizedPoint *p = all[k];
                pts[k] = @[@(p.location.x), @(p.location.y), @(p.confidence)];
              }
              obj[@"points"] = pts;
              obj[@"conf"] = @(obs.confidence);
            }
            NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
            [lines addObject:[[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding]];
            used++;
          }
        }
        idx++;
        CFRelease(sb);
      }
      [[lines componentsJoinedByString:@"\n"] writeToFile:outFile atomically:YES encoding:NSUTF8StringEncoding error:nil];
      printf("total frames: %d, sampled: %d, pose outputs: %lu\n", idx, used, (unsigned long)lines.count);
      printf("reader status: %ld (0=unknown 1=reading 2=completed 3=failed 4=cancelled)\n", (long)reader.status);
      if (reader.error) printf("reader error: %s\n", [[reader.error localizedDescription] UTF8String]);
      return 0;
    }
  }
  return 0;
}
