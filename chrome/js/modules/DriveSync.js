var DriveSync = Backbone.Model.extend({
    defaults: function() {
        return {
        	initializedSync: false,
        	lastSynced: "",
        	canSync: false,
        	isSyncing: false,
        	fileSystem: null,
        	queue: []
        };
    },

    initialize: function(options) {
    	console.log("DriveSync", "Initializing syncable file system");
    	this.openSyncableFileSystem();
    },

    errorHandler:function (e) {
        var msg = '';

        switch (e.code) {
        case FileError.QUOTA_EXCEEDED_ERR:
            msg = 'QUOTA_EXCEEDED_ERR';
            break;
        case FileError.NOT_FOUND_ERR:
            msg = 'NOT_FOUND_ERR';
            break;
        case FileError.SECURITY_ERR:
            msg = 'SECURITY_ERR';
            break;
        case FileError.INVALID_MODIFICATION_ERR:
            msg = 'INVALID_MODIFICATION_ERR';
            break;
        case FileError.INVALID_STATE_ERR:
            msg = 'INVALID_STATE_ERR';
            break;
        default:
            msg = 'Unknown Error';
            break;
        }

        console.log("DriveSync", 'Error: ' + msg);
    },

    openSyncableFileSystem: function() {
    	var model = this;

        var canSync = pm.settings.getSetting("driveSyncEnabled");
        canSync = true;

        if (!canSync) {
            console.log("DriveSync", "Drive sync is disabled");
            return false;
        }
        else {
            chrome.syncFileSystem.requestFileSystem(function (fs) {
                console.log("DriveSync", "Received file system");

                if (chrome.runtime.lastError) {
                    // TODO Need to handle this in a better way
                    error('requestFileSystem: ' + chrome.runtime.lastError.message);
                    return;
                }

                _.bind(model.onFileSystemOpened, model)(fs);
            });

            return true;
        }
    },

    isSyncingInitialized: function() {
    	return this.get("initializedSync");
    },

    onFileSystemOpened: function(fs) {
    	var model = this;

    	this.set("fileSystem", fs);
    	console.log("DriveSync", 'Got FileSystem:', fs);
    	this.set("initializedSync", true);
    	pm.mediator.trigger("initializedSyncableFileSystem");

    	pm.mediator.on("addSyncableFile", function(syncableFile, callback) {
    		console.log("DriveSync", "addSyncableFile", syncableFile);
    		model.syncFile(syncableFile, callback);
    	});

    	pm.mediator.on("updateSyncableFile", function(syncableFile, callback) {
    		console.log("DriveSync", "updateSyncableFile", syncableFile);
    		model.syncFile(syncableFile, callback);
    	});

    	pm.mediator.on("removeSyncableFile", function(name, callback) {
    		console.log("DriveSync", "removeSyncableFile", name);
    		model.removeFile(name);
    	});

    	pm.mediator.on("getSyncableFileData", function(fileEntry, callback) {
    		model.getFile(fileEntry, callback);
    	});

    	this.startListeningForChanges();
    },

    removeFileIfExists:function (name, callback) {
    	var fileSystem = this.get("fileSystem");

        fileSystem.root.getFile(name, {create:false},
        	function (fileEntry) {
                fileEntry.remove(function () {
                	if (callback) {
                		callback();
                	}

                }, function () {
                	if (callback) {
                		callback();
                	}

                });
            },
            function () {
            	if (callback) {
            		callback();
            	}
        	}
    	);
    },

    // Add/edit file
    syncFile: function(syncableFile, callback) {
    	console.log("DriveSync", "Starting to sync file");

    	var fileSystem = this.get("fileSystem");
    	var name = syncableFile.name;
    	var data = syncableFile.data;
    	var errorHandler = this.errorHandler;

    	fileSystem.root.getFile(name,
    	    {create:true},
    	    function (fileEntry) {
    	        if (!fileEntry) {
                    return;
                }

                fileEntry.createWriter(function(writer) {
                    var truncated = false;

                    writer.onerror = function (e) {
                    	if (callback) {
                    		callback("failed");
                    	}
                    };

                    writer.onwriteend = function(e) {
                        if (!truncated) {
                            truncated = true;
                            this.truncate(this.position);
                            return;
                        }

                        if (callback) {
                        	callback("success");
                        }

                    };

                    blob = new Blob([data], {type:'text/plain'});

                    writer.write(blob);
                }, errorHandler);
    	    }, errorHandler
    	);
    },

    getFile: function(fileEntry, callback) {

    	var errorHandler = this.errorHandler;

    	fileEntry.file(function(file) {

			var reader = new FileReader();
			reader.readAsText(file, "utf-8");

			reader.onload = function(ev) {
				if (callback) {
					callback(ev.target.result);
				}
			};
    	}, errorHandler);
    },

    // Remove file
    removeFile: function(name, callback) {
    	this.removeFileIfExists(name, callback);
    },

    startListeningForChanges: function() {
    	var model = this;

    	chrome.syncFileSystem.onFileStatusChanged.addListener(
			function(detail) {
				_.bind(model.onSyncableFileStatusChanged, model)(detail);
			}
		);
    },

    onSyncableFileStatusChanged: function(detail) {
    	var direction = detail.direction;
    	var action = detail.action;
    	var name = detail.fileEntry.name;
    	var status = detail.status;
    	var s = splitSyncableFilename(name);

    	var id = s.id;
    	var type = s.type;

        console.log("DriveSync", "File status was changed", detail);

    	if (status === "synced") {
    	    if (direction === "remote_to_local") {
    	        if (action === "added") {
    	            console.log("DriveSync", "Add local file", id);
    	            this.getFile(detail.fileEntry, function(data) {
                        console.log("DriveSync", "Received data", data);
    	            	pm.mediator.trigger("addSyncableFileFromRemote", type, data);
    	            });
    	        }
    	        else if (action === "updated") {
    	        	console.log("DriveSync", "Update local file", id);
    	        	this.getFile(detail.fileEntry, function(data) {
                        console.log("DriveSync", "Received data", data);
    	        		pm.mediator.trigger("updateSyncableFileFromRemote", type, data);
    	        	});
    	        }
    	        else if (action === "deleted") {
    	            console.log("DriveSync","Delete local data", id);
    	            pm.mediator.trigger("deleteSyncableFileFromRemote", type, id);
    	        }
    	    }
    	    else {
    	        console.log("DriveSync","direction was local_to_remote");
    	    }
    	}
    	else {
    	    console.log("DriveSync","Not synced");
    	}
    }
});