(async()=>{
    const d=new Date(),dateTag=`${String(d.getDate()).padStart(2,"0")}${d.toLocaleString("en-US",{month:"short"}).toUpperCase()}${String(d.getFullYear()).slice(-2)}`,hostKey=location.hostname.split(".")[0].toUpperCase(),jobName=window.__cdpJobConfig?.name||`ImportJob_${dateTag}`,sourceObjectName=`PROFILE_${hostKey}`,C={
        description:"Independent import draft validation",source:window.__cdpJobConfig?.sourceName||`OOS-SRC-${dateTag}`,template:"ResponsysProfile",frequency:window.__cdpSchedule?.frequency||"Daily",notify:"test.user@oracle.com"
  },nextRun=(()=>{
        const x=new Date();
    x.setHours(x.getHours()+1,0,0,0);
    return x
  })(),nextHour24=nextRun.getHours(),nextHourButtonset=nextHour24<12?"recurring-hourly-am":"recurring-hourly-pm",nextHourValue=String(nextHour24),sleep=ms=>new Promise(r=>setTimeout(r,ms)),visible=e=>!!e&&e.getClientRects().length>0,textOf=e=>(e.textContent||"").replace(/\s+/g," ").trim(),normalize=s=>(s||"").replace(/\s+/g,"").trim().toLowerCase(),find=s=>[...document.querySelectorAll(s)].find(visible),wait=async(fn,label,timeout=3000)=>{
        timeout=Math.min(timeout,3000);
    const end=Date.now()+timeout;
    while(Date.now()<end){
            const value=typeof fn==="string"?find(fn):fn();
      if(value)return value;
      await sleep(150)
    }
        throw new Error("Not available after 3 seconds: "+label)
  },setValue=(el,value)=>{
        el.scrollIntoView({
            block:"center"
    });
    el.focus();
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
    setter?setter.call(el,value):el.value=value;
    ["input","change"].forEach(type=>el.dispatchEvent(new Event(type,{
            bubbles:true
    })))
  },hover=async el=>{
        el.scrollIntoView({
            block:"center"
    });
    const options={
            bubbles:true,cancelable:true,view:window
    };
    el.dispatchEvent(new MouseEvent("mouseover",options));
    el.dispatchEvent(new MouseEvent("mouseenter",options));
    el.dispatchEvent(new MouseEvent("mousemove",options));
    await sleep(400)
  },mouseClick=async el=>{
        el.scrollIntoView({
            block:"center"
    });
    el.focus?.();
    const options={
            bubbles:true,cancelable:true,view:window,button:0,buttons:1
    };
    if(typeof PointerEvent!=="undefined")el.dispatchEvent(new PointerEvent("pointerdown",{
            ...options,pointerType:"mouse"
    }));
    el.dispatchEvent(new MouseEvent("mousedown",options));
    el.dispatchEvent(new MouseEvent("mouseup",{
            ...options,buttons:0
    }));
    el.click();
    await sleep(500);
    return el
  },commitField=async el=>{
        el.dispatchEvent(new Event("input",{
            bubbles:true
    }));
    el.dispatchEvent(new Event("change",{
            bubbles:true
    }));
    el.dispatchEvent(new Event("focusout",{
            bubbles:true
    }));
    el.blur?.();
    await sleep(400)
  },click=async target=>mouseClick(typeof target==="string"?await wait(target,target):target),clickEnabled=async(selector,label)=>click(await wait(()=>{
        const candidates=[...document.querySelectorAll(selector)].filter(visible);
    return candidates.find(x=>!x.disabled&&x.getAttribute("aria-disabled")!=="true"&&!x.closest("oj-button")?.classList.contains("oj-disabled"))||null
  },label)),labelFor=input=>input.closest("label")||input.closest(".oj-choice-item,.oj-radio-wrapper,.oj-choice-row,.oj-button-toggle")?.querySelector("label")||document.querySelector(`label[for="${CSS.escape(input.id)}"]`)||input,chooseSearch=async(id,text)=>{
        const input=await wait(()=>document.getElementById(id),"dropdown "+id),host=input.closest("oj-select-single,oj-combobox-one,oj-combobox-many"),trigger=host?.querySelector(".oj-searchselect-arrow,.oj-searchselect-main-field,.oj-text-field-container,[role=combobox]")||input;
    await click(trigger);
    const field=id.split("|input")[0],filter=await wait(()=>{
            const x=document.getElementById("oj-searchselect-filter-"+field+"|input");
      return visible(x)?x:(host?.querySelector("input:not([type=hidden]):not([disabled])")||input)
    },"dropdown filter");
    setValue(filter,text);
    await sleep(700);
    const option=await wait(()=>{
            const options=[...document.querySelectorAll('[role="option"],oj-option,li')].filter(visible);
      return options.find(x=>normalize(x.textContent)===normalize(text)||normalize(x.getAttribute("value"))===normalize(text))||options.find(x=>normalize(x.textContent).startsWith(normalize(text)))||null
    },"option "+text);
    await click(option.closest('[role="option"]')||option.closest("li,oj-option")||option);
    await sleep(400);
    return input
  },renameSourceObject=async()=>{
        if(document.getElementById(sourceObjectName))return;
    const ellipsis=await wait(()=>document.getElementById("PROFILE"),"PROFILE ellipsis"),hoverTarget=ellipsis.parentElement||ellipsis;
    await hover(hoverTarget);
    await hover(ellipsis);
    await mouseClick(ellipsis);
    const editAction=await wait(()=>[...document.querySelectorAll('[role="menuitem"],oj-option,button,a,li,span,div')].find(x=>visible(x)&&textOf(x)==="Edit")||null,"Edit source object action");
    await mouseClick(editAction.closest('[role="menuitem"],oj-option,button,a,li')||editAction);
    const nameInput=await wait(()=>[...document.querySelectorAll('input:not([type="hidden"]),textarea')].find(x=>visible(x)&&String(x.value||"").trim()==="PROFILE")||null,"PROFILE rename input");
    setValue(nameInput,sourceObjectName);
    await sleep(1000);
    const editor=nameInput.closest("oj-dialog,[role='dialog'],.oj-popup,.oj-popup-content")||document,saveAction=[...editor.querySelectorAll("button,oj-button button,[role='button']")].find(x=>visible(x)&&/^(save|apply|ok|done)$/i.test(textOf(x)));
    if(saveAction){
            await mouseClick(saveAction)
    }
        else{
            nameInput.dispatchEvent(new KeyboardEvent("keydown",{
                key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true
      }));
      nameInput.dispatchEvent(new KeyboardEvent("keyup",{
                key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true
      }));
      await commitField(nameInput)
    }
        await wait(()=>document.getElementById(sourceObjectName)||[...document.querySelectorAll(".ellipsis-id")].find(x=>x.id===sourceObjectName)||null,"renamed source object "+sourceObjectName)
  },chooseFrequency=async text=>{
        const choice=await wait(()=>[...document.querySelectorAll("#oj-select-choice-frequency")].find(visible)||null,"frequency dropdown"),arrow=choice.querySelector(".oj-select-arrow")||choice,list=()=>[...document.querySelectorAll("#oj-listbox-results-frequency")].find(visible);
    await mouseClick(arrow);
    try{
            await wait(()=>choice.getAttribute("aria-expanded")==="true"&&list()?list():null,"open frequency options",2000)
    }
        catch(_){
            await mouseClick(choice);
      choice.dispatchEvent(new KeyboardEvent("keydown",{
                key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true
      }));
      await wait(()=>list()||null,"open frequency options",3000)
    }
        const option=await wait(()=>[...list().querySelectorAll('[role="option"]')].find(x=>visible(x)&&normalize(textOf(x))===normalize(text)),"frequency option "+text);
    await mouseClick(option);
    await wait(()=>{
            const selected=[...document.querySelectorAll("#frequency_selected")].find(visible);
      return selected&&normalize(textOf(selected))===normalize(text)?selected:null
    },"selected frequency "+text)
  },chooseButton=async(id,value)=>{
        const input=await wait(()=>[...document.querySelectorAll(`oj-buttonset-many#${CSS.escape(id)} input[value="${value}"]`)].find(x=>{
            const host=x.closest("oj-buttonset-many");
      return host&&visible(host)
    })||null,id+" option");
    await click(labelFor(input));
    await wait(()=>input.checked?input:null,`${id} value ${value} selected`)
  };
    const chooseSearchWithFallback=async(id,label,preferredValue)=>{
          const deadline=Date.now()+60000;
          let lastError;
          while(Date.now()<deadline){
                try{
                return await chooseSearch(id,preferredValue)
      }
                catch(error){
                lastError=error;
        await sleep(1000)
      }
    }
          throw new Error(`${label} "${preferredValue}" was not available after waiting for CDP to save it. ${lastError?.message||""}`.trim());
  };
    const selectNewSchedulerChoice=async(value,label)=>{
          const values=Array.isArray(value)?value:[value];
          const input=await wait(()=>{
                const choices=[...document.querySelectorAll("oj-radioset#recurring-or-manual input")];
                return choices.find(item=>visible(item.closest("oj-radioset"))&&values.some(candidate=>String(item.value||"").toLowerCase()===String(candidate).toLowerCase()))||null;
    },label);
          await mouseClick(labelFor(input));
          await wait(()=>input.checked?input:null,label+" selected",10000);
  };
    const chooseNewSchedulerFrequency=async frequency=>{
          const input=await wait(()=>document.getElementById("requency|input"),"new scheduler frequency");
          await mouseClick(input);
          const menu=await wait(()=>{
                const popup=document.getElementById("lovDropdown_requency");
                return popup&&visible(popup)?popup:null;
    },"new scheduler frequency options",10000);
          const wanted=normalize(frequency);
          const option=await wait(()=>{
                const choices=[...menu.querySelectorAll("[role='option'],[role='gridcell'],li,oj-option")].filter(visible);
                return choices.find(item=>normalize(textOf(item))===wanted)||
                  choices.find(item=>normalize(textOf(item)).startsWith(wanted))||null;
    },"new scheduler frequency "+frequency,10000);
          await mouseClick(option.closest("[role='option'],[role='gridcell'],li,oj-option")||option);
          await wait(()=>normalize(input.value).startsWith(wanted)?input:null,"new scheduler frequency selected",10000);
  };
    const selectNewSchedulerTimeMode=async value=>{
          const input=await wait(()=>{
                const choices=[...document.querySelectorAll("oj-radioset#specific_or_interval input")];
                return choices.find(item=>visible(item.closest("oj-radioset"))&&String(item.value||"").toLowerCase()===String(value).toLowerCase())||null;
    },"new scheduler "+value);
          await mouseClick(labelFor(input));
          await wait(()=>input.checked?input:null,"new scheduler "+value+" selected",10000);
  };
    const newSchedulerDate=()=>{
          const schedule=window.__cdpSchedule||{};
          if(Number.isFinite(Number(schedule.scheduledAt)))return new Date(Number(schedule.scheduledAt));
          const result=new Date();
          const preset=schedule.specificPreset||schedule.startTime||"in15";
          if(preset==="in30")result.setMinutes(result.getMinutes()+30);
          else if(preset==="in15")result.setMinutes(result.getMinutes()+15);
          else if(preset==="plusOneHour")result.setHours(result.getHours()+1);
          else if(preset==="immediate")result.setMinutes(result.getMinutes()+15);
          else if(preset==="custom"&&schedule.customTime){
                const [hours,minutes]=String(schedule.customTime).split(":").map(Number);
                if(Number.isInteger(hours)&&Number.isInteger(minutes))result.setHours(hours,minutes,0,0);
    }
          return result;
  };
    const newSchedulerTimeText=date=>{
          const hour=date.getHours()%12||12;
          return `${hour}:${String(date.getMinutes()).padStart(2,"0")} ${date.getHours()>=12?"PM":"AM"}`;
  };
    const newSchedulerInput=async(id,label)=>{
          return await wait(()=>document.getElementById(id+"|input")||document.getElementById(id)||null,label,10000);
  };
    const setNewSchedulerTime=async(input,value)=>{
          const result=await new Promise((resolve,reject)=>{
                const receive=event=>{
                      clearTimeout(timeout);
                      try{resolve(JSON.parse(String(event.detail||"{}")));}
                      catch(error){reject(error);}
    };
                const timeout=setTimeout(()=>{
                      window.removeEventListener("cdp-import-schedule-time-result",receive);
                      reject(new Error("Timed out committing Import schedule time."));
    },10000);
                window.addEventListener("cdp-import-schedule-time-result",receive,{once:true});
                window.dispatchEvent(new CustomEvent("cdp-import-schedule-time-request",{
                      detail:JSON.stringify({inputId:input.id,value})
    }));
  });
          if(!result?.ok)throw new Error(result?.error||"Could not commit Import schedule time.");
  };
    const configureNewSchedulerLocally=async()=>{
          const schedule=window.__cdpSchedule||{};
          const mode=String(schedule.mode||"scheduled").toLowerCase();
          if(mode==="ondemand"){
                await selectNewSchedulerChoice(["onDemand","manual"],"new scheduler On demand");
                return;
    }
          await selectNewSchedulerChoice("recurring","new scheduler Recurring");
          await chooseNewSchedulerFrequency(schedule.frequency||"Daily");
          const timeMode=String(schedule.timeMode||"specific").toLowerCase();
          await selectNewSchedulerTimeMode(timeMode);
          if(timeMode==="interval"){
                const interval=await newSchedulerInput("interval","new scheduler interval");
                const start=await newSchedulerInput("interval_start_time","new scheduler interval start time");
                const end=await newSchedulerInput("interval_end_time","new scheduler interval end time");
                const startAt=newSchedulerDate();
                const endAt=new Date(startAt);
                const [endHours,endMinutes]=String(schedule.intervalEndTime||"23:59").split(":").map(Number);
                if(Number.isInteger(endHours)&&Number.isInteger(endMinutes))endAt.setHours(endHours,endMinutes,0,0);
                await setJetValueAndValidate(interval,String(schedule.intervalHours||"1"));
                await setNewSchedulerTime(start,newSchedulerTimeText(startAt));
                await setNewSchedulerTime(end,newSchedulerTimeText(endAt));
                return;
    }
          // #times also contains helper/hidden inputs.  The actual Oracle JET
          // time control is marked specific-time-length; targeting it avoids
          // sending the time to a non-bound input and leaving the default
          // 12:00 AM value in the scheduler.
          const timeInput=await wait(()=>[...document.querySelectorAll("#times oj-input-time.specific-time-length input, #times .specific-time-length input")]
                .find(item=>visible(item)&&!item.disabled&&!item.id.startsWith("interval_"))||null,"new scheduler specific time",10000);
          await setNewSchedulerTime(timeInput,newSchedulerTimeText(newSchedulerDate()));
  };
    const setJetValueAndValidate=async(el,value)=>{
          el.scrollIntoView({
            block:"center"
    });
          el.focus();
          const component=el.closest("oj-input-text,oj-text-area,oj-select-single,oj-combobox-one,oj-combobox-many");
          const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
          setter?setter.call(el,value):el.value=value;
          el.dispatchEvent(new InputEvent("input",{
                bubbles:true,
                composed:true,
                inputType:"insertText",
                data:String(value)
    }));
          el.dispatchEvent(new Event("change",{
            bubbles:true,composed:true
    }));
          if(component){
                try{
                      if(typeof component.setProperty==="function"){
                            component.setProperty("rawValue",String(value));
                            component.setProperty("value",String(value));
        }
                else{
                            component.rawValue=String(value);
                            component.value=String(value);
        }
      }
            catch(_){
      }
                try{
                      component.dispatchEvent(new CustomEvent("rawValueChanged",{
                            bubbles:true,
                            composed:true,
                            detail:{
                        value:String(value)
          }
        }));
                      component.dispatchEvent(new CustomEvent("valueChanged",{
                            bubbles:true,
                            composed:true,
                            detail:{
                        value:String(value)
          }
        }));
      }
            catch(_){
      }
                try{
                      if(typeof component.validate==="function"){
                            await component.validate();
        }
      }
            catch(_){
      }
    }
          el.dispatchEvent(new Event("focusout",{
            bubbles:true,composed:true
    }));
          el.blur?.();
          await sleep(500);
  };
    const waitForContinueEnabled=async(id="job-details-continue-editjob")=>{
          return await wait(()=>{
                const host=document.getElementById(id);
                const button=host?.querySelector("button");
                const hostDisabled=
                  host?.classList.contains("oj-disabled")||
                  host?.getAttribute("aria-disabled")==="true";
                const buttonDisabled=!!button?.disabled;
                return host&&button&&!hostDisabled&&!buttonDisabled?button:null;
    },id+" enabled",3000);
  };
    const waitLong=async(fn,label,timeout=120000)=>{
          const end=Date.now()+timeout;
          while(Date.now()<end){
                const value=typeof fn==="string"?find(fn):fn();
                if(value)return value;
                await sleep(250)
    }
          throw new Error("Timed out waiting for: "+label)
  };
    const createSourceObjectAndUploadSample=async()=>{
          const createButton=await wait(()=>{
                const candidates=[...document.querySelectorAll("oj-button,button,[role='button']")].filter(visible);
                return candidates.find(x=>normalize(textOf(x)).includes(normalize("Create source object")))||null
    },"Create source object button");
          await click(createButton.querySelector?.("button")||createButton);
          const objectNameInput=await wait(()=>document.getElementById("object-name-input|input"),"source object name");
          await setJetValueAndValidate(objectNameInput,sourceObjectName);
          const dialog=objectNameInput.closest("oj-dialog,[role='dialog'],.oj-dialog,.oj-popup")||document;
          const confirmButton=await wait(()=>{
                const candidates=[...dialog.querySelectorAll("oj-button,button,[role='button']")].filter(visible);
                return candidates.find(x=>{
                      const label=normalize(textOf(x));
                      const button=x.matches("button")?x:x.querySelector?.("button");
                      const enabled=button?!button.disabled:true;
                      return enabled&&["create","save","continue","next","done"].some(t=>label===normalize(t)||label.includes(normalize(t)))
      })||null
    },"Create source object confirmation");
          await click(confirmButton.querySelector?.("button")||confirmButton);
          const picker=await waitLong(()=>{
                const candidates=[...document.querySelectorAll("oj-file-picker .oj-filepicker-dropzone,oj-file-picker .oj-filepicker-container,oj-file-picker")].filter(visible);
                return candidates[0]||null
    },"sample CSV file picker");
          const csvContent=window.__cdpImportConfig?.csvContent;
          if(!csvContent)throw new Error("Import Job sample CSV was not provided.");
          const file=new File([csvContent],"cdp_field_mapping.csv",{
            type:"text/csv"
    });
          const filePicker=picker.closest("oj-file-picker")||document.querySelector("oj-file-picker");
          let accepted=false;
          try{
                const transfer=new DataTransfer();
                transfer.items.add(file);
                picker.dispatchEvent(new DragEvent("dragenter",{
                      bubbles:true,
                      cancelable:true,
                      composed:true,
                      dataTransfer:transfer
      }));
                picker.dispatchEvent(new DragEvent("dragover",{
                      bubbles:true,
                      cancelable:true,
                      composed:true,
                      dataTransfer:transfer
      }));
                picker.dispatchEvent(new DragEvent("drop",{
                      bubbles:true,
                      cancelable:true,
                      composed:true,
                      dataTransfer:transfer
      }));
                await sleep(800);
                accepted=!![...document.querySelectorAll(".file-list .filename")].find(x=>textOf(x)==="cdp_field_mapping.csv");
    }
        catch(_e){
    }
          if(!accepted&&filePicker){
                try{
                      const transfer=new DataTransfer();
                      transfer.items.add(file);
                      filePicker.dispatchEvent(new CustomEvent("ojSelect",{
                            bubbles:true,
                            cancelable:true,
                            composed:true,
                            detail:{
                                  files:transfer.files,
                                  originalEvent:null
          }
        }));
                      await sleep(800);
                      accepted=!![...document.querySelectorAll(".file-list .filename")].find(x=>textOf(x)==="cdp_field_mapping.csv");
      }
            catch(_e){
      }
    }
          if(!accepted){
                throw new Error("Oracle did not accept the generated CSV file automatically.");
    }
          const startMappingButton=await waitLong(()=>{
                const candidates=[...document.querySelectorAll("oj-button.btn-start-mapping,oj-button,button")].filter(visible);
                for(const candidate of candidates){
                      const label=normalize(textOf(candidate));
                      if(!label.includes(normalize("Start mapping")))continue;
                      const host=candidate.closest("oj-button")||candidate;
                      const button=host.matches("button")?host:host.querySelector("button");
                      const disabled=
                        host.classList?.contains("oj-disabled")||
                        host.getAttribute?.("aria-disabled")==="true"||
                        !!button?.disabled;
                      if(!disabled)return button||host
      }
                return null
    },"enabled Start Mapping button");
          await click(startMappingButton);
          await waitLong(()=>{
                const dialogs=[...document.querySelectorAll("oj-dialog,[role='dialog'],.oj-dialog,.oj-popup")].filter(visible);
                const processing=dialogs.find(x=>{
                      const t=normalize(textOf(x));
                      return t.includes(normalize("Processing. Please wait"))&&
                             t.includes(normalize("Cancel"));
      });
                return processing?null:true;
    },"mapping processing dialog to close",120000);
          if(typeof window.runCdpFieldMapping!=="function"){
                throw new Error("The shared Import Job field mapper was not loaded.");
          }
          await window.runCdpFieldMapping(window.__cdpImportConfig?.targetTables,window.__cdpImportConfig?.fieldToTable);
  };
    try{
        if(!location.href.includes("root=createConnectJob"))throw new Error("Open /data/?root=createConnectJob before running.");
    if(!hostKey)throw new Error("Could not extract the host key from the current URL.");
    await wait("div[class*='create-connect-job-body']","Create Ingest Job");
    const jobInput=await wait(()=>document.getElementById("job-name-input|input"),"job name");
    await setJetValueAndValidate(jobInput,jobName);
    const descriptionInput=await wait(()=>document.getElementById("job-desc-text-area|input"),"description");
    await setJetValueAndValidate(descriptionInput,C.description);
    await chooseSearchWithFallback("job-details-sources|input","Source",C.source);
    await click(await waitForContinueEnabled("job-details-continue-editjob"));
    await createSourceObjectAndUploadSample();
    await waitLong("oj-list-view#fieldMappingList ul[role='grid'][aria-label='FieldMappingData']","field mapping table",120000);
    await waitLong("oj-list-view#fieldMappingList li[role='row']","field mapping rows",120000);
    await clickEnabled("#field-mapping-container oj-button button","Field Mapping Continue");
    await wait(".schedule-job-container","schedule page");
    const scheduleMode=window.__cdpSchedule?.mode;
    // New Scheduler is applied by the shared page bridge before the job save.
    // Legacy Scheduler keeps the page-local recurring/manual controls.
    if(window.__cdpSchedule?.schedulerUi==="new"){
            await configureNewSchedulerLocally();
    }
        else{
            const recurring=await wait(()=>[...document.querySelectorAll("oj-radioset#recurring-or-manual input[value='Recurring']")].find(x=>{
                const host=x.closest("oj-radioset");
        return host&&visible(host)
      })||null,"Recurring schedule"),manual=scheduleMode==="onDemand"?await wait(()=>[...document.querySelectorAll("oj-radioset#recurring-or-manual input[value='Manual'],oj-radioset#recurring-or-manual input[value='OnDemand']")].find(x=>{
                const host=x.closest("oj-radioset");
        return host&&visible(host)
      })||null,"On-demand schedule"):null;
      await click(labelFor(scheduleMode==="onDemand"?manual:recurring));
      if(scheduleMode!=="onDemand"){
                await chooseFrequency(C.frequency);
        await chooseButton(nextHourButtonset,nextHourValue);
        if(C.frequency==="Weekly")await chooseButton("recurring-weekly","2");
      }
    }
        const notifyInput=await wait(()=>document.getElementById("notify-input|input"),"notification email");
    setValue(notifyInput,C.notify);
    await commitField(notifyInput);
    await clickEnabled("oj-button#saveNclose-create-job button","Save and Close")
  }
    catch(error){
        console.error("Import bookmark failed",error);
    alert("Import bookmark failed:\n"+error.message)
  }
})();
