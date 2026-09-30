// Fallback copy of the 2012-2013 engine's HTML5 audio player (utils/audioController.js), taken unchanged from
// the episodes that ship it (all 41 copies are identical). Late builds of that engine ("video 2.25") were
// packaged for the native apps, which played sound natively, and left this file out; sw.js serves this copy
// when an episode's zip does not contain it.

// todo проверить, чтобы на timer висели только громкости, а на timeout только выключение и перемотка
// todo внимательно посмотреть на currentBg

function AudioController() {
    this.audioObjects = new Object();
    this.asyncSounds = new Array();
    this.currentBg = undefined;
    this.mv = 1; // master volume
}

//typedef enum {
//    SIExposedAudioPlayerTypeUndefined = 0,
//        SIExposedAudioPlayerTypeSfx = 1,
//        SIExposedAudioPlayerTypeBg = 2,
//        SIExposedAudioPlayerTypeDynamic = 3
//} SIExposedAudioPlayerType;

AudioController.prototype.addSoundToList = function(key, fileName, type) {
    if ((type == undefined) || (type == 3)) type = 0;
    if (this.audioObjects[key] === undefined) this.audioObjects[key] = new Object();
    if (this.audioObjects[key].player !== undefined) {
        if (type == 2) {
            this.audioObjects[key].type = 2;
            if (this.audioObjects[key].player.ended) this.audioObjects[key].player.currentTime = 0;
            this.audioObjects[key].player.loop = 1;
            return;
        } else {
            delete(this.audioObjects[key].player);
        }
    }

    this.audioObjects[key].player = document.createElement('audio');
    this.audioObjects[key].player.src = fileName;
    if (type == 2) {
        this.audioObjects[key].player.loop = 1;
    }
    this.audioObjects[key].volume = 1;
    this.audioObjects[key].dVolume = 1;
    this.audioObjects[key].player.volume = this.mv;
    this.audioObjects[key].player.load();
    this.audioObjects[key].type = type;
};

AudioController.prototype.removeSoundFromList = function(key) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    this.audioObjects[key].player.removeEventListener("ended", this.audioObjects[key].onended);
    clearInterval(this.audioObjects[key].player.timer);
    clearTimeout(this.audioObjects[key].player.timeout);
    this.audioObjects[key].player.pause();
    this.audioObjects[key].type = undefined;
    delete(this.audioObjects[key].player);
    if (key == this.currentBg) {
        this.currentBg = undefined;
    }
};

// при повторном запуске переписывает times
AudioController.prototype.playSound = function(key, times) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if ((this.audioObjects[key].player.paused != 1) && (this.audioObjects[key].player.ended != 1)) {
        if (times === 0) {
            this.audioObjects[key].player.loop = '1';
            this.audioObjects[key].player.removeEventListener("ended", this.audioObjects[key].onended);
        } else {
            this.audioObjects[key].player.loop = undefined;
            if (times === undefined) times = 1;
            this.audioObjects[key].times = times;
        }
        return;
    }

    if (this.audioObjects[key].player.ended) this.audioObjects[key].player.currentTime = 0;

    if (times === 0) {
        this.audioObjects[key].player.loop = '1';
    } else {
        this.audioObjects[key].player.loop = undefined;
        if (times === undefined) times = 1;
        this.audioObjects[key].times = times;
        var that = this;
        this.audioObjects[key].onended = function() {that.onEnded(key);};
        this.audioObjects[key].player.addEventListener("ended", this.audioObjects[key].onended);
    }
    this.audioObjects[key].volume = this.audioObjects[key].dVolume;
    this.audioObjects[key].player.volume = this.audioObjects[key].volume * this.mv;
    if (this.audioObjects[key].player.readyState > 0) {
        this.audioObjects[key].player.play();
    } else {
        this.audioObjects[key].player.addEventListener("canplay", function() {
            this.play();
            this.removeEventListener("canplay", arguments.callee);
        });
    }
};


AudioController.prototype.playSoundAsync = function(key) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if ((this.audioObjects[key].player.paused != 1) && (this.audioObjects[key].player.ended != 1)) {
        for (var i = 0; i < this.asyncSounds.length; i++) {
            if (this.asyncSounds[i] === undefined) {
                break;
            }
        }
        this.asyncSounds[i] = document.createElement('audio');
        this.asyncSounds[i].index = this.asyncSounds[i];
        this.asyncSounds[i].src = this.audioObjects[key].player.src;
        this.asyncSounds[i].volume = this.audioObjects[key].dVolume * this.mv;
        this.asyncSounds[i].dVolume = this.audioObjects[key].dVolume;
        this.asyncSounds[i].load();
        this.asyncSounds[i].onended = function() {
            this.removeEventListener("ended", this.onended);
            delete(this);
        };
        this.asyncSounds[i].addEventListener("ended", this.asyncSounds[i].onended);
        if (this.asyncSounds[i].readyState > 0) {
            this.asyncSounds[i].play();
        } else {
            this.asyncSounds[i].addEventListener("canplay", function() {this.play();})
        }
    } else {
        this.audioObjects[key].volume = this.audioObjects[key].dVolume;
        this.audioObjects[key].player.volume = this.audioObjects[key].volume * this.mv;
        if (this.audioObjects[key].player.readyState > 0) {
            if (this.audioObjects[key].player.ended) this.audioObjects[key].currentTime = 0;
            this.audioObjects[key].player.play();
        } else {
            this.audioObjects[key].player.addEventListener("canplay", function() {
                if (this.ended) this.currentTime = 0;
                this.play();
                this.removeEventListener("canplay", arguments.callee);
            });
        }
    }
};


AudioController.prototype.playSoundTo = function(key, end) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if (this.audioObjects[key].player.readyState > 0) {
        if (end > this.audioObjects[key].player.duration) end = this.audioObjects[key].player.duration;
        end -= (this.audioObjects[key].player.currentTime * 1000 + 20);
        if (end > 0) {
            this.audioObjects[key].volume = this.audioObjects[key].dVolume;
            this.audioObjects[key].player.volume = this.audioObjects[key].volume * this.mv;
            this.audioObjects[key].times = 1;
            this.audioObjects[key].player.play();
            var player = this.audioObjects[key].player;
            this.audioObjects[key].timeout = setTimeout(function() {player.pause(); player.currentTime = 0; }, end);
        }
    } else {
        var that = this;
        this.audioObjects[key].player.addEventListener(
            "canplay",
            function() {
                if (end > this.duration) end = this.duration;
                end -= (this.currentTime * 1000 + 20);
                if (end > 0) {
                    that.audioObjects[key].volume = that.audioObjects[key].dVolume;
                    this.volume = that.audioObjects[key].volume * that.mv;
                    that.audioObjects[key].times = 1;
                    this.play();
                    var player = this;
                    that.audioObjects[key].timeout = setTimeout(function() {player.pause(); player.currentTime = 0; }, end);
                    this.removeEventListener("canplay", arguments.callee);
                }
            }
        );
    }
};

AudioController.prototype.playSoundFromTo = function(key, begin, end) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if (this.audioObjects[key].player.readyState > 0) {
        this.audioObjects[key].player.currentTime = begin / 1000;
        if (end > this.audioObjects[key].player.duration) end = this.audioObjects[key].player.duration;
        end -= (begin + 20);
        if (end > 0) {
            this.audioObjects[key].volume = this.audioObjects[key].dVolume;
            this.audioObjects[key].player.volume = this.audioObjects[key].volume * this.mv;
            this.audioObjects[key].times = 1;
            this.audioObjects[key].player.play();
            var player = this.audioObjects[key].player;
            this.audioObjects[key].timeout = setTimeout(function() {player.pause(); player.currentTime = 0; }, end);
        }
    } else {
        var that = this;
        this.audioObjects[key].player.addEventListener(
            "canplay",
            function() {
                this.currentTime = begin / 1000;
                if (end > this.duration) end = this.duration;
                end -= (begin + 20);
                if (end > 0) {
                    that.audioObjects[key].volume = that.audioObjects[key].dVolume;
                    this.volume = that.audioObjects[key].volume * this.mv;
                    that.audioObjects[key].times = 1;
                    this.play();
                    var player = this;
                    that.audioObjects[key].timeout = setTimeout(function() {player.pause(); player.currentTime = 0; }, end);
                    this.removeEventListener("canplay", arguments.callee);
                }
            }
        );
    }
};

AudioController.prototype.setVolumeForSoundTo = function(key, volume) {
    if ((volume < 0) || (volume > 1)) return;
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    this.audioObjects[key].dVolume = volume;
    this.audioObjects[key].volume = volume;
    this.audioObjects[key].player.volume = volume * this.mv;
    if (this.audioObjects[key].player.timer != undefined) clearInterval(this.audioObjects[key].player.timer);
};

AudioController.prototype.playSoundFirstMs = function(key, dur) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    this.playSoundFromTo(0, dur);
};

// если звук фоновый, то она останавливает с фейдом прошлый фоновый и запускает с фейдом новый фоновый
// если звук не фоновый, то просто запускает с фейдом с 0 до 1
// если звук уже играет, игнорируем
AudioController.prototype.fadeInAndPlay = function(key, dur) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if ((this.audioObjects[key].player.paused != 1) && (this.audioObjects[key].player.ended != 1)) return;
    if (dur == undefined) dur = 500;
    if ((this.audioObjects[key].type == 0) || (this.audioObjects[key].type == 1)) {

        if (this.audioObjects[key].player.readyState > 0) {
            if (this.audioObjects[key].player.ended) this.audioObjects[key].player.currentTime = 0;
            this.audioObjects[key].player.play();
        } else {
            this.audioObjects[key].player.addEventListener("canplay", function() {
                if (this.ended) this.currentTime = 0;
                this.play();
                this.removeEventListener("canplay", arguments.callee);
            });
        }

        this.audioObjects[key].player.volume = 0;
        this.audioObjects[key].volume = 0;
        this.fadeVolumeToInt(key, this.audioObjects[key].dVolume, dur);
    } else if (this.audioObjects[key].type == 2) {
//        if (this.currentBg != undefined) {
//            this.fadeOutAndAct(this.currentBg, 4, dur);
//        }
        for (var i in this.audioObjects) {
            if ((i != key) && (this.audioObjects[i].type == 2) && (this.audioObjects[i].player != undefined)) {
                this.fadeOutAndAct(i, 4, dur);
            }
        }
        this.currentBg = key;
        if (this.audioObjects[key].player.readyState > 0) {
            this.audioObjects[key].player.play();
        } else {
            this.audioObjects[key].player.addEventListener("canplay", function() {
                this.play();
                this.removeEventListener("canplay", arguments.callee);
            });
        }
        this.audioObjects[key].player.volume = 0;
        this.audioObjects[key].volume = 0;
        this.fadeVolumeToInt(key, this.audioObjects[key].dVolume, dur);
    }
};

AudioController.prototype.pauseSound = function(key) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    this.audioObjects[key].player.pause();
    if (this.audioObjects[key].timeout !== undefined) clearTimeout(this.audioObjects[key].timeout);
    this.audioObjects[key].player.removeEventListener("ended", this.audioObjects[key].onended);
    this.audioObjects[key].onended = undefined;
};

AudioController.prototype.stopSound = function(key) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if (this.audioObjects[key].player.readyState > 0) {
        this.audioObjects[key].player.pause();
        this.audioObjects[key].player.currentTime = 0;
    } else {
        this.audioObjects[key].player.addEventListener(
            "canplay",
            function() {
                this.player.pause();
                this.currentTime = 0;
                this.removeEventListener("canplay", arguments.callee);
            }
        );
    }
    if (this.audioObjects[key].timeout !== undefined) clearTimeout(this.audioObjects[key].timeout);
    this.audioObjects[key].player.removeEventListener("ended", this.audioObjects[key].onended);
    this.audioObjects[key].onended = undefined;
};

//    SIExposedAudioPlayerActionNone = -1,
//    SIExposedAudioPlayerActionPlay = 0,
//    SIExposedAudioPlayerActionPause = 1,
//    SIExposedAudioPlayerActionStop = 2,
//    SIExposedAudioPlayerActionUnload = 3,
//    SIExposedAudioPlayerActionRemove = 4

// если плеер не играет, то dur = 0
AudioController.prototype.fadeOutAndAct = function(key, action, dur) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if (dur == undefined) dur = 500;
    if ((this.audioObjects[key].player.paused == 1) || (this.audioObjects[key].player.ended == 1)) dur = 0;
    var that = this;
    this.fadeVolumeToInt(key, 0, dur);
    if (action == 1) {
        if (dur > 0) {
            this.audioObjects[key].timeout = setTimeout(function() {that.pauseSound(key); if (that.paused == 1) {that.audioObjects[key].pausedOnDemand = 0;}}, dur);
        } else {
            this.pauseSound(key);
        }
    } else if (action === 2) {
        if (dur > 0) {
            this.audioObjects[key].timeout = setTimeout(function() {that.stopSound(key); if (that.paused == 1) {that.audioObjects[key].pausedOnDemand = 0;}}, dur);
        } else {
            this.stopSound(key);
        }
    } else if (action === 4) {
        if (dur > 0) {
            this.audioObjects[key].timeout = setTimeout(function() {that.removeSoundFromList(key); if (that.paused == 1) {that.audioObjects[key].pausedOnDemand = 0;}}, dur);
        } else {
            this.removeSoundFromList(key);
        }
    }
};

AudioController.prototype.fadeVolumeTo = function(key, volume, dur, type) {
    if ((volume < 0) || (volume > 1)) return;
    this.fadeVolumeToInt(key, volume, dur, 1);
}

AudioController.prototype.fadeVolumeToInt = function(key, volume, dur, type) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if (dur == undefined) dur = 500;

    clearInterval(this.audioObjects[key].player.timer);

    if (type == 1) this.audioObjects[key].dVolume = volume;

    if (dur <= 20) {
        this.audioObjects[key].volume = volume;
        this.audioObjects[key].player.volume = volume * this.mv;
        return;
    }
    var player = this.audioObjects[key];
    var volumeDelta = volume - player.volume;
    var volumeStep = volumeDelta / 15;
    var volumeInterval = dur / 15;
    var that = this;
    player.timer = setInterval(
        function() {
            if (((volume - player.volume) * (volume - player.volume - volumeStep)) <= 0) {
                player.volume = volume;
                clearInterval(player.timer);
            } else {
                player.volume = Math.max(0, Math.min(1, player.volume + volumeStep));
            }
            if (player.player !== undefined) {
                player.player.volume = parseFloat(player.volume * that.mv);
            }
        },
        volumeInterval
    );

};

AudioController.prototype.onEnded = function(key) {
    this.audioObjects[key].times -= 1;
    if (this.audioObjects[key].times > 0) {
        this.audioObjects[key].player.currentTime = 0;
        this.audioObjects[key].player.play();
    } else {
        this.audioObjects[key].player.removeEventListener("ended", this.audioObjects[key].onended);
    }
};
AudioController.prototype.setNumberOfLoopsForSound = function(key, times) {
    if ((this.audioObjects[key] == undefined) || (this.audioObjects[key].player == undefined)) return;
    if ((this.audioObjects[key].player.paused != 1) && (this.audioObjects[key].player.ended != 1)) return;
    if (this.audioObjects[key].player.ended == 1) this.audioObjects[key].player.currentTime = 0;
    if (times === 0) {
        this.audioObjects[key].player.loop = '1';
    } else {
        this.audioObjects[key].player.loop = undefined;
        if (times === undefined) times = 1;
        this.audioObjects[key].times = times;
        var that = this;
        this.audioObjects[key].onended = function() {that.onEnded(key);};
        this.audioObjects[key].player.addEventListener("ended", this.audioObjects[key].onended);
    }
};

AudioController.prototype.stopAllSounds = function() {
    var key;
    for (key in this.audioObjects) {
        if (this.audioObjects.hasOwnProperty(key)) {
            if ((this.audioObjects[key].player !== undefined) && (!(this.audioObjects[key].player.paused))) {
                this.stopSound(key);
            }
        }
    }
    this.currentBg = undefined;
};

AudioController.prototype.addBg = function(key, fileName) {
    this.addSoundToList(key, fileName, 2);
};

AudioController.prototype.playBg = function(key, dur) {
    this.fadeInAndPlay(key, dur);
    this.currentBg = key;
};

AudioController.prototype.pauseBg = function(key, dur) {
    this.fadeOutAndAct(key, 1, dur);
    this.currentBg = undefined;
};

AudioController.prototype.stopBg = function(key, dur) {
    this.fadeOutAndAct(key, 2, dur);
    this.currentBg = undefined;
};

AudioController.prototype.addSfx = function(key, fileName) {
    this.addSoundToList(key, fileName, 1);
};

AudioController.prototype.playSfx = function(key) {
    this.playSoundAsync(key);
};

AudioController.prototype.unloadAllSfx = function() {
    var key;
    for (key in this.audioObjects) {
        if (this.audioObjects.hasOwnProperty(key)) {
            if ((this.audioObjects[key].player !== undefined) && (this.audioObjects[key].type == 1)) {
                this.removeSoundFromList(key);
            }
        }
    }

    for (var i = 0; i < this.asyncSounds.length; i++) {
        if (this.asyncSounds[i] !== undefined) {
            this.asyncSounds[i].removeEventListener("ended", this.onended);
            this.asyncSounds[i].pause();
            delete(this.asyncSounds[i]);
        }
    }
};

AudioController.prototype.deleteAllSounds = function() {
    for (var key in this.audioObjects) {
        if (this.audioObjects.hasOwnProperty(key)) {
            if (this.audioObjects[key].player != undefined) {
                this.audioObjects[key].player.removeEventListener("ended", this.audioObjects[key].onended);
                clearInterval(this.audioObjects[key].player.timer);
                clearTimeout(this.audioObjects[key].player.timeout);
                this.audioObjects[key].player.pause();
                delete(this.audioObjects[key].player);
            }
        }
    }

    for (key = 0; key < this.asyncSounds.length; key++) {
        if (this.asyncSounds[key] != undefined) {
            this.asyncSounds[key].pause();
            this.asyncSounds[key].removeEventListener("ended", this.asyncSounds[key].onended);
            delete(this.asyncSounds[key]);
        }
    }
};

AudioController.prototype.pauseAllSounds = function() {
    var that = this;
    this.paused = 1;
    if (this.currentBg != undefined) {
        this.currentBgVolume = this.audioObjects[this.currentBg].volume;
    }
    for (var key in that.audioObjects) {
        if (that.audioObjects.hasOwnProperty(key)) {
            if (that.audioObjects[key].player != undefined) {
                clearTimeout(that.audioObjects[key].timer);
            }
        }
    }
    var i = 0;
    var t = setInterval(function() {
        i++;
        for (var key in that.audioObjects) {
            if (that.audioObjects.hasOwnProperty(key)) {
                if ((that.audioObjects[key].player != undefined) && ((that.audioObjects[key].player.paused != 1) && (that.audioObjects[key].player.ended != 1))) {
                    if (key != that.currentBg) {
                        that.audioObjects[key].volume = parseFloat(Math.max(that.audioObjects[key].volume - 0.1, 0));
                    } else {
                        that.audioObjects[key].volume = parseFloat(Math.max(that.audioObjects[key].volume - 0.1 * that.currentBgVolume, 0));
                    }
                    that.audioObjects[key].player.volume = parseFloat(that.audioObjects[key].volume * that.mv);
                }
            }
        }
        for (key = 0; key < that.asyncSounds.length; key++) {
            if ((that.asyncSounds[key] != undefined) && ((that.asyncSounds[key].paused != 1) && (that.asyncSounds[key].ended != 1))) {
                that.asyncSounds[key].dVolume = Math.max(that.asyncSounds[key].dVolume - 0.1, 0);
                that.asyncSounds[key].volume = parseFloat(that.asyncSounds[key].dVolume * that.mv);
            }
        }

        if (i > 9) {
            clearInterval(t);
        }
    }, 30);

    setTimeout(function() {
        for (var key in that.audioObjects) {
            if (that.audioObjects.hasOwnProperty(key)){
                if ((that.audioObjects[key].player != undefined) && ((that.audioObjects[key].player.paused != 1) && (that.audioObjects[key].player.ended != 1))) {
                    that.audioObjects[key].pausedOnDemand = 1;
                    that.audioObjects[key].volume = 0;
                    that.audioObjects[key].player.volume = 0;
                    that.audioObjects[key].player.pause();
                }
            }
        }
        for (key = 0; key < that.asyncSounds.length; key++) {
            if ((that.asyncSounds[key] != undefined) && ((that.asyncSounds[key].paused != 1) && (that.asyncSounds[key].ended != 1))) {
                that.asyncSounds[key].pause();
                that.asyncSounds[key].removeEventListener("ended", that.asyncSounds[key].onended);
                delete(that.asyncSounds[key]);
            }
        }
    }, 300);
};

AudioController.prototype.resumeAllSounds = function() {
    var that = this;
    var i;
    this.paused = 0;

    for (i in this.audioObjects) {
        if (this.audioObjects.hasOwnProperty(i)) {
            if ((this.audioObjects[i].player != undefined) && (this.audioObjects[i].pausedOnDemand == 1)) {
                that.audioObjects[i].player.play();
                that.audioObjects[i].pausedOnDemand = 0;
            }
        }
    }

    var t = setInterval(function() {
        i++;
        for (var key in that.audioObjects) {
            if (that.audioObjects.hasOwnProperty(key)) {
                if ((that.audioObjects[key].player != undefined) && ((that.audioObjects[key].player.paused != 1) && (that.audioObjects[key].player.ended != 1))) {
                    if (key != that.currentBg) {
                        that.audioObjects[key].volume = parseFloat(Math.min(that.audioObjects[key].volume + 0.1, that.audioObjects[key].dVolume));
                    } else {
                        that.audioObjects[key].volume = parseFloat(Math.min(that.audioObjects[key].volume + 0.1 * that.currentBgVolume, that.audioObjects[key].dVolume));
                    }
                    that.audioObjects[key].player.volume = parseFloat(that.audioObjects[key].volume * that.mv);
                }
            }
        }

        if (i > 9) {
            clearInterval(t);
        }
    }, 30);

    setTimeout(function() {
        for (var key in that.audioObjects) {
            if (that.audioObjects.hasOwnProperty(key)) {
                if ((that.audioObjects[key].player != undefined) && ((that.audioObjects[key].player.paused != 1) && (that.audioObjects[key].player.ended != 1))) {
                    if (key != that.currentBg) {
                        that.audioObjects[key].volume = parseFloat(that.audioObjects[key].dVolume);
                    } else {
                        that.audioObjects[key].volume = parseFloat(that.currentBgVolume);
                    }
                    that.audioObjects[key].player.volume = parseFloat(that.audioObjects[key].volume * that.mv);
                }
            }
        }
    }, 300);
};

AudioController.prototype.setMasterVolume = function(v) {
    var key;
    v = Math.max(Math.min(v, 1), 0);
    this.mv = v;
    for (key in this.audioObjects) {
        if (this.audioObjects.hasOwnProperty(key)) {
            if (this.audioObjects[key].player != undefined) {
                this.audioObjects[key].player.volume = parseFloat(this.audioObjects[key].volume * v);
            }
        }
    }

    for (key = 0; key < this.asyncSounds.length; key++) {
        if (this.asyncSounds[key] != undefined) {
            this.asyncSounds[key].volume = parseFloat(this.asyncSounds[key].dVolume * v);
        }
    }
};